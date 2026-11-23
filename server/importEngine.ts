import * as XLSX from 'xlsx';
import type {
  ColumnMapping,
  ModelCompatibilityReport,
  RowValidationIssue,
  RowValidationPreviewItem,
  RowValidationReport,
  SatisfactionScale,
  TicketAggregationSummary,
  UploadPathway,
} from '../src/types/churn.ts';
import type { TrainedModelArtifact } from './mlEngine.ts';
import { base64ToUint8Array, isMissingValue, parseCsvText, utf8BytesToString } from './mlEngine.ts';

export interface MultiSheetParseResult {
  headers: string[];
  rows: Record<string, string>[];
  sourceFormat: 'csv' | 'xlsx';
  ticketSheetHeaders: string[];
  ticketSheetRows: Record<string, string>[];
  detectedUploadMode: 'customer' | 'tickets';
}

function sheetToUniqueMatrixRows(sheet: XLSX.WorkSheet): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  const nonEmptyRows = matrix.filter(
    (r) => Array.isArray(r) && r.some((cell) => String(cell ?? '').trim() !== '')
  );
  if (nonEmptyRows.length < 2) {
    return { headers: [], rows: [] };
  }

  const rawHeaders = nonEmptyRows[0].map((h, idx) => {
    const s = String(h ?? '').trim();
    return s || `Column_${idx + 1}`;
  });
  const seen = new Set<string>();
  const uniqueHeaders = rawHeaders.map((h) => {
    let candidate = h;
    let suffix = 2;
    while (seen.has(candidate)) {
      candidate = `${h}_${suffix++}`;
    }
    seen.add(candidate);
    return candidate;
  });

  const rows: Record<string, string>[] = [];
  for (let r = 1; r < nonEmptyRows.length; r++) {
    const values = nonEmptyRows[r];
    const rowObj: Record<string, string> = {};
    for (let c = 0; c < uniqueHeaders.length; c++) {
      rowObj[uniqueHeaders[c]] =
        values[c] !== undefined && values[c] !== null ? String(values[c]).trim() : '';
    }
    rows.push(rowObj);
  }
  return { headers: uniqueHeaders, rows };
}

function looksLikeTicketDataset(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase());
  const hasTicketId = lower.some((h) => h === 'ticket_id' || h === 'ticketid' || h === 'case_id');
  const hasTicketFields = lower.some(
    (h) =>
      h.includes('ticket_status') ||
      h.includes('ticket_category') ||
      h.includes('ticket_priority') ||
      h.includes('resolution_duration') ||
      h.includes('ticket_created')
  );
  const hasCustomerFinancials = lower.some(
    (h) =>
      h.includes('revenue') ||
      h === 'mrr' ||
      h === 'arr' ||
      h.includes('monthly_charges') ||
      h.includes('tenure') ||
      h.includes('churn_status')
  );
  return (hasTicketId || hasTicketFields) && !hasCustomerFinancials;
}

export function parseMultiSheetSpreadsheetUpload(input: {
  fileName: string;
  csvText?: string;
  fileBase64?: string;
  requestedUploadMode?: 'customer' | 'tickets';
}): MultiSheetParseResult {
  const lowerName = (input.fileName || '').toLowerCase();
  const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');

  if (!isExcel && input.csvText && typeof input.csvText === 'string') {
    const { headers, rows } = parseCsvText(input.csvText);
    const detectedUploadMode: 'customer' | 'tickets' =
      input.requestedUploadMode === 'tickets' || looksLikeTicketDataset(headers)
        ? 'tickets'
        : 'customer';
    return {
      headers,
      rows,
      sourceFormat: 'csv',
      ticketSheetHeaders: detectedUploadMode === 'tickets' ? headers : [],
      ticketSheetRows: detectedUploadMode === 'tickets' ? rows : [],
      detectedUploadMode,
    };
  }

  if (input.fileBase64 && typeof input.fileBase64 === 'string') {
    const bytes = base64ToUint8Array(input.fileBase64);
    if (bytes.length === 0) {
      throw new Error('The uploaded spreadsheet file is empty.');
    }

    if (!isExcel) {
      const text = utf8BytesToString(bytes);
      const { headers, rows } = parseCsvText(text);
      const detectedUploadMode: 'customer' | 'tickets' =
        input.requestedUploadMode === 'tickets' || looksLikeTicketDataset(headers)
          ? 'tickets'
          : 'customer';
      return {
        headers,
        rows,
        sourceFormat: 'csv',
        ticketSheetHeaders: detectedUploadMode === 'tickets' ? headers : [],
        ticketSheetRows: detectedUploadMode === 'tickets' ? rows : [],
        detectedUploadMode,
      };
    }

    const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
    if (!workbook.SheetNames.length) {
      throw new Error('The Excel workbook contains no readable sheets.');
    }

    const explicitCustomerSheetName = workbook.SheetNames.find((n) =>
      /^(customer_data|customer data|historical_customer_data|new_business_customers|customers|current_customers_to_score)$/i.test(
        n.trim()
      )
    );
    const explicitTicketSheetName = workbook.SheetNames.find((n) =>
      /^(ticket_data|ticket data|tickets|support_tickets|customer_tickets)$/i.test(n.trim())
    );
    const fallbackDataSheetName = workbook.SheetNames.find(
      (n) =>
        !/^(field_guide|field guide|instructions|scoring_instructions|model_input_specification|ticket_data|ticket data|tickets|support_tickets|customer_tickets)$/i.test(
          n.trim()
        )
    );

    // If workbook has Ticket_Data and no explicit/non-reference customer sheet, treat as standalone Ticket_Data
    if (!explicitCustomerSheetName && explicitTicketSheetName && !fallbackDataSheetName) {
      const parsedTickets = sheetToUniqueMatrixRows(workbook.Sheets[explicitTicketSheetName]);
      if (parsedTickets.rows.length === 0) {
        throw new Error('Ticket_Data worksheet must contain a header row and at least one ticket row.');
      }
      return {
        headers: parsedTickets.headers,
        rows: parsedTickets.rows,
        sourceFormat: 'xlsx',
        ticketSheetHeaders: parsedTickets.headers,
        ticketSheetRows: parsedTickets.rows,
        detectedUploadMode: 'tickets',
      };
    }

    const customerSheetName =
      explicitCustomerSheetName || fallbackDataSheetName || workbook.SheetNames[0];

    const parsedPrimary = sheetToUniqueMatrixRows(workbook.Sheets[customerSheetName]);
    if (parsedPrimary.rows.length === 0) {
      throw new Error('Excel sheet must contain a header row and at least one data row.');
    }

    let ticketSheetHeaders: string[] = [];
    let ticketSheetRows: Record<string, string>[] = [];
    if (explicitTicketSheetName && explicitTicketSheetName !== customerSheetName) {
      const parsedTickets = sheetToUniqueMatrixRows(workbook.Sheets[explicitTicketSheetName]);
      ticketSheetHeaders = parsedTickets.headers;
      ticketSheetRows = parsedTickets.rows;
    }

    const hasConsolidatedWorkbook = Boolean(explicitCustomerSheetName && explicitTicketSheetName);
    const detectedUploadMode: 'customer' | 'tickets' = hasConsolidatedWorkbook
      ? 'customer'
      : input.requestedUploadMode === 'tickets' ||
          (ticketSheetRows.length === 0 && looksLikeTicketDataset(parsedPrimary.headers))
        ? 'tickets'
        : 'customer';

    if (detectedUploadMode === 'tickets' && ticketSheetRows.length === 0) {
      ticketSheetHeaders = parsedPrimary.headers;
      ticketSheetRows = parsedPrimary.rows;
    }

    return {
      headers: parsedPrimary.headers,
      rows: parsedPrimary.rows,
      sourceFormat: 'xlsx',
      ticketSheetHeaders,
      ticketSheetRows,
      detectedUploadMode,
    };
  }

  throw new Error('No CSV or Excel file payload was provided.');
}

function findHeader(headers: string[], candidates: string[]): string | null {
  const byLower = new Map(headers.map((h) => [h.toLowerCase(), h]));
  for (const cand of candidates) {
    const exact = byLower.get(cand.toLowerCase());
    if (exact) return exact;
  }
  for (const cand of candidates) {
    const partial = headers.find((h) => h.toLowerCase().includes(cand.toLowerCase()));
    if (partial) return partial;
  }
  return null;
}

function parseNumericStrict(val: string | undefined): number | null {
  if (isMissingValue(val)) return null;
  const cleaned = String(val).replace(/[$,%\s,]/g, '').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function isValidIsoOrStandardDate(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed || /^\d+(\.\d+)?$/.test(trimmed)) return false;
  if (
    !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed) &&
    !/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(trimmed)
  ) {
    return false;
  }
  const ts = Date.parse(trimmed);
  return !Number.isNaN(ts);
}

export interface AggregatedCustomerTickets {
  customerId: string;
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  unresolvedTickets: number;
  escalatedTickets: number;
  avgResolutionDays: number | null;
  lastTicketDate: string | null;
}

export function aggregateTicketsByCustomer(
  ticketRows: Record<string, string>[],
  ticketHeaders: string[],
  options?: { validCustomerIds?: Set<string> }
): {
  byCustomerId: Map<string, AggregatedCustomerTickets>;
  duplicateTicketIds: number;
  invalidTicketRows: number;
  validTicketRows: number;
  warningTicketRows: number;
  errorTicketRows: number;
  unmatchedTicketRowsCount: number;
  ticketRowIssues: RowValidationIssue[];
} {
  const custIdCol = findHeader(ticketHeaders, [
    'customer_id',
    'customerid',
    'account_id',
    'member_id',
    'workspace_id',
    'patient_id',
    'policyholder_id',
    'learner_id',
    'client_id',
  ]);
  const ticketIdCol = findHeader(ticketHeaders, ['ticket_id', 'ticketid', 'case_id', 'id']);
  const statusCol = findHeader(ticketHeaders, ['ticket_status', 'status', 'resolution_status']);
  const createdCol = findHeader(ticketHeaders, [
    'ticket_created_date',
    'created_date',
    'created_at',
    'opened_date',
  ]);
  const resolvedCol = findHeader(ticketHeaders, [
    'ticket_resolved_date',
    'resolved_date',
    'closed_date',
  ]);
  const durationCol = findHeader(ticketHeaders, [
    'resolution_duration_days',
    'resolution_days',
    'resolution_time_days',
  ]);
  const escalatedCol = findHeader(ticketHeaders, ['escalated', 'escalation', 'is_escalated']);

  const validCustomerIds = options?.validCustomerIds;
  const seenTicketIds = new Set<string>();
  let duplicateTicketIds = 0;
  let invalidTicketRows = 0;
  let validTicketRows = 0;
  let warningTicketRows = 0;
  let errorTicketRows = 0;
  let unmatchedTicketRowsCount = 0;
  const ticketRowIssues: RowValidationIssue[] = [];

  const buckets = new Map<
    string,
    {
      displayId: string;
      total: number;
      open: number;
      resolved: number;
      unresolved: number;
      escalated: number;
      durations: number[];
      lastTs: number;
      lastDateStr: string | null;
    }
  >();

  ticketRows.forEach((row, idx) => {
    const errorMessages: string[] = [];
    const warningMessages: string[] = [];
    const rawCid = custIdCol ? String(row[custIdCol] || '').trim() : '';
    const rawTid = ticketIdCol ? String(row[ticketIdCol] || '').trim() : '';

    if (isMissingValue(rawCid)) {
      errorMessages.push('Missing Customer_ID on ticket record.');
    }

    if (ticketIdCol && isMissingValue(rawTid)) {
      warningMessages.push('Missing Ticket_ID; ticket deduplication relies on unique Ticket_ID.');
    }

    if (rawTid && !isMissingValue(rawTid)) {
      const tidKey = rawTid.toLowerCase();
      if (seenTicketIds.has(tidKey)) {
        duplicateTicketIds++;
        errorMessages.push(`Duplicate Ticket_ID "${rawTid}" skipped to avoid double-counting.`);
        invalidTicketRows++;
        errorTicketRows++;
        ticketRowIssues.push({
          rowIndex: idx + 1,
          customerId: rawCid || `Ticket#${idx + 1}`,
          status: 'error',
          messages: [...errorMessages, ...warningMessages],
        });
        return;
      }
      seenTicketIds.add(tidKey);
    }

    let durDays = durationCol ? parseNumericStrict(row[durationCol]) : null;
    if (durDays !== null && durDays < 0) {
      warningMessages.push(`Negative Resolution_Duration_Days (${durDays}) ignored.`);
      durDays = null;
    }

    const createdStr = createdCol ? String(row[createdCol] || '').trim() : '';
    if (createdStr && !isMissingValue(createdStr) && !isValidIsoOrStandardDate(createdStr)) {
      warningMessages.push(`Invalid Ticket_Created_Date "${createdStr}".`);
    }

    const resolvedStr = resolvedCol ? String(row[resolvedCol] || '').trim() : '';
    if (resolvedStr && !isMissingValue(resolvedStr) && !isValidIsoOrStandardDate(resolvedStr)) {
      warningMessages.push(`Invalid Ticket_Resolved_Date "${resolvedStr}".`);
    }

    if (
      createdStr &&
      resolvedStr &&
      isValidIsoOrStandardDate(createdStr) &&
      isValidIsoOrStandardDate(resolvedStr)
    ) {
      const cTs = Date.parse(createdStr);
      const rTs = Date.parse(resolvedStr);
      if (!Number.isNaN(cTs) && !Number.isNaN(rTs)) {
        if (rTs < cTs) {
          warningMessages.push(
            `Ticket_Resolved_Date (${resolvedStr}) is earlier than Ticket_Created_Date (${createdStr}).`
          );
        } else if (durDays === null) {
          durDays = Number(((rTs - cTs) / (1000 * 60 * 60 * 24)).toFixed(2));
        }
      }
    }

    if (
      validCustomerIds &&
      validCustomerIds.size > 0 &&
      !isMissingValue(rawCid) &&
      !validCustomerIds.has(rawCid.toLowerCase())
    ) {
      unmatchedTicketRowsCount++;
      warningMessages.push(
        `Customer_ID "${rawCid}" was not found in Customer_Data (unmatched ticket record).`
      );
    }

    if (errorMessages.length > 0) {
      invalidTicketRows++;
      errorTicketRows++;
      ticketRowIssues.push({
        rowIndex: idx + 1,
        customerId: rawCid || `Ticket#${idx + 1}`,
        status: 'error',
        messages: [...errorMessages, ...warningMessages],
      });
    } else if (warningMessages.length > 0) {
      invalidTicketRows++;
      warningTicketRows++;
      ticketRowIssues.push({
        rowIndex: idx + 1,
        customerId: rawCid || `Ticket#${idx + 1}`,
        status: 'warning',
        messages: warningMessages,
      });
    } else {
      validTicketRows++;
    }

    if (isMissingValue(rawCid)) return;

    const cidKey = rawCid.toLowerCase();
    let bucket = buckets.get(cidKey);
    if (!bucket) {
      bucket = {
        displayId: rawCid,
        total: 0,
        open: 0,
        resolved: 0,
        unresolved: 0,
        escalated: 0,
        durations: [],
        lastTs: 0,
        lastDateStr: null,
      };
      buckets.set(cidKey, bucket);
    }

    bucket.total++;
    const statusLower = statusCol ? String(row[statusCol] || '').trim().toLowerCase() : '';
    if (/(resolved|closed|done|completed)/.test(statusLower)) {
      bucket.resolved++;
    } else if (/(open|pending|unresolved|in progress|waiting|new)/.test(statusLower)) {
      bucket.open++;
      bucket.unresolved++;
    } else if (!statusLower && resolvedStr && !isMissingValue(resolvedStr)) {
      bucket.resolved++;
    } else if (!statusLower) {
      bucket.open++;
      bucket.unresolved++;
    } else {
      bucket.unresolved++;
    }

    const escLower = escalatedCol ? String(row[escalatedCol] || '').trim().toLowerCase() : '';
    if (escLower === 'yes' || escLower === 'true' || escLower === '1') {
      bucket.escalated++;
    }

    if (durDays !== null && durDays >= 0) {
      bucket.durations.push(durDays);
    }

    if (createdStr && !Number.isNaN(Date.parse(createdStr))) {
      const ts = Date.parse(createdStr);
      if (ts >= bucket.lastTs) {
        bucket.lastTs = ts;
        bucket.lastDateStr = createdStr;
      }
    }
  });

  const byCustomerId = new Map<string, AggregatedCustomerTickets>();
  for (const [k, b] of buckets.entries()) {
    const avgRes =
      b.durations.length > 0
        ? Number((b.durations.reduce((a, x) => a + x, 0) / b.durations.length).toFixed(2))
        : null;
    byCustomerId.set(k, {
      customerId: b.displayId,
      totalTickets: b.total,
      openTickets: b.open,
      resolvedTickets: b.resolved,
      unresolvedTickets: b.unresolved,
      escalatedTickets: b.escalated,
      avgResolutionDays: avgRes,
      lastTicketDate: b.lastDateStr,
    });
  }

  return {
    byCustomerId,
    duplicateTicketIds,
    invalidTicketRows,
    validTicketRows,
    warningTicketRows,
    errorTicketRows,
    unmatchedTicketRowsCount,
    ticketRowIssues,
  };
}

export function mergeTicketsIntoCustomerRows(params: {
  source: TicketAggregationSummary['source'];
  customerHeaders: string[];
  customerRows: Record<string, string>[];
  ticketHeaders: string[];
  ticketRows: Record<string, string>[];
  idColumnHint?: string | null;
}): {
  headers: string[];
  rows: Record<string, string>[];
  summary: TicketAggregationSummary;
  duplicateTicketIds: number;
  ticketRowIssues: RowValidationIssue[];
} {
  const { source, customerHeaders, customerRows, ticketHeaders, ticketRows, idColumnHint } = params;

  const custIdCol =
    (idColumnHint && customerHeaders.includes(idColumnHint) ? idColumnHint : null) ||
    findHeader(customerHeaders, [
      'customer_id',
      'customerid',
      'account_id',
      'member_id',
      'workspace_id',
      'patient_id',
      'policyholder_id',
      'learner_id',
      'client_id',
      'id',
    ]);

  const validCustomerIds = new Set<string>();
  if (custIdCol) {
    for (const row of customerRows) {
      const cid = String(row[custIdCol] || '').trim();
      if (!isMissingValue(cid)) {
        validCustomerIds.add(cid.toLowerCase());
      }
    }
  }

  const agg = aggregateTicketsByCustomer(ticketRows, ticketHeaders, {
    validCustomerIds: validCustomerIds.size > 0 ? validCustomerIds : undefined,
  });

  const totalTicketsCol =
    findHeader(customerHeaders, ['total_tickets_raised', 'tickets_raised', 'support_tickets']) ||
    'total_tickets_raised';
  const openTicketsCol =
    findHeader(customerHeaders, ['open_tickets']) || 'open_tickets';
  const resolvedTicketsCol =
    findHeader(customerHeaders, ['resolved_tickets']) || 'resolved_tickets';
  const unresolvedTicketsCol =
    findHeader(customerHeaders, ['unresolved_tickets', 'pending_tickets']) || 'unresolved_tickets';
  const avgResCol =
    findHeader(customerHeaders, [
      'average_resolution_days',
      'avg_resolution_days',
      'resolution_time_days',
    ]) || 'average_resolution_days';

  const nextHeaders = Array.from(
    new Set([
      ...customerHeaders,
      totalTicketsCol,
      openTicketsCol,
      resolvedTicketsCol,
      unresolvedTicketsCol,
      avgResCol,
    ])
  );

  const matchedIds = new Set<string>();
  const existingSummaryAlreadyPopulated = customerRows.some(
    (r) =>
      parseNumericStrict(r[totalTicketsCol]) !== null &&
      parseNumericStrict(r[totalTicketsCol])! > 0
  );

  // Strict 1:1 map over customerRows: multiple tickets per Customer_ID never create duplicate customer records
  const mergedRows = customerRows.map((row) => {
    const nextRow: Record<string, string> = { ...row };
    for (const h of nextHeaders) {
      if (nextRow[h] === undefined) nextRow[h] = '';
    }

    if (!custIdCol) return nextRow;
    const cidKey = String(row[custIdCol] || '').trim().toLowerCase();
    if (!cidKey) return nextRow;

    const ticketMetrics = agg.byCustomerId.get(cidKey);
    if (!ticketMetrics) return nextRow;
    matchedIds.add(cidKey);

    // DOUBLE-COUNTING PREVENTION RULE:
    // Never sum ticket-sheet counts onto existing customer-level summary counts.
    // Fill missing summary values or reconcile with aggregated ticket records cleanly.
    const existingTotal = parseNumericStrict(row[totalTicketsCol]);
    const shouldReconcileFromTickets =
      existingTotal === null ||
      existingTotal === 0 ||
      ticketMetrics.totalTickets > existingTotal;

    if (shouldReconcileFromTickets) {
      nextRow[totalTicketsCol] = String(ticketMetrics.totalTickets);
      nextRow[openTicketsCol] = String(ticketMetrics.openTickets);
      nextRow[resolvedTicketsCol] = String(ticketMetrics.resolvedTickets);
      nextRow[unresolvedTicketsCol] = String(ticketMetrics.unresolvedTickets);
      if (ticketMetrics.avgResolutionDays !== null) {
        nextRow[avgResCol] = String(ticketMetrics.avgResolutionDays);
      }
    } else {
      if (parseNumericStrict(row[openTicketsCol]) === null) {
        nextRow[openTicketsCol] = String(ticketMetrics.openTickets);
      }
      if (parseNumericStrict(row[resolvedTicketsCol]) === null) {
        nextRow[resolvedTicketsCol] = String(ticketMetrics.resolvedTickets);
      }
      if (parseNumericStrict(row[unresolvedTicketsCol]) === null) {
        nextRow[unresolvedTicketsCol] = String(ticketMetrics.unresolvedTickets);
      }
      if (parseNumericStrict(row[avgResCol]) === null && ticketMetrics.avgResolutionDays !== null) {
        nextRow[avgResCol] = String(ticketMetrics.avgResolutionDays);
      }
    }

    return nextRow;
  });

  const unmatchedTicketCustomers = Math.max(0, agg.byCustomerId.size - matchedIds.size);

  const summary: TicketAggregationSummary = {
    source,
    ticketRowsCount: ticketRows.length,
    validTicketRows: agg.validTicketRows,
    warningTicketRows: agg.warningTicketRows,
    errorTicketRows: agg.errorTicketRows,
    duplicateTicketIds: agg.duplicateTicketIds,
    invalidTicketRows: agg.invalidTicketRows,
    matchedCustomersCount: matchedIds.size,
    unmatchedTicketCount: unmatchedTicketCustomers,
    unmatchedTicketRowsCount: agg.unmatchedTicketRowsCount,
    doubleCountingPrevented: true,
    ticketIssues: agg.ticketRowIssues.slice(0, 50),
    note: existingSummaryAlreadyPopulated
      ? `Linked ${ticketRows.length} ticket records across ${matchedIds.size} customers (${agg.validTicketRows} clean, ${agg.warningTicketRows} warnings, ${agg.errorTicketRows} errors). Existing customer ticket summaries were reconciled without double-counting.`
      : `Validated and aggregated ${ticketRows.length} ticket records into ${matchedIds.size} unique customers (${agg.validTicketRows} clean, ${agg.warningTicketRows} warnings, ${agg.errorTicketRows} errors) with duplicate Ticket_IDs skipped.`,
  };

  return {
    headers: nextHeaders,
    rows: mergedRows,
    summary,
    duplicateTicketIds: agg.duplicateTicketIds,
    ticketRowIssues: agg.ticketRowIssues,
  };
}

export function checkModelCompatibility(
  uploadedHeaders: string[],
  artifact: TrainedModelArtifact | null | undefined
): ModelCompatibilityReport {
  if (!artifact) {
    return {
      modelAvailable: false,
      modelVersion: null,
      modelName: null,
      compatible: false,
      requiredFeatures: [],
      matchedFeatures: [],
      missingFeatures: [],
      message:
        'No validated historical churn model is active in this workspace yet. You can monitor customer analytics now and upload historical churn data later to unlock prediction scoring.',
    };
  }

  const lowerUploaded = new Set(uploadedHeaders.map((h) => h.trim().toLowerCase()));
  const requiredFeatures = artifact.features.map((f) => f.column);
  const matchedFeatures = requiredFeatures.filter((f) =>
    lowerUploaded.has(f.trim().toLowerCase())
  );
  const missingFeatures = requiredFeatures.filter(
    (f) => !lowerUploaded.has(f.trim().toLowerCase())
  );

  const compatible = matchedFeatures.length > 0 && missingFeatures.length <= Math.floor(requiredFeatures.length * 0.4);

  return {
    modelAvailable: true,
    modelVersion: artifact.evaluation.version,
    modelName: artifact.evaluation.modelName,
    compatible,
    requiredFeatures,
    matchedFeatures,
    missingFeatures,
    message:
      missingFeatures.length === 0
        ? `All ${requiredFeatures.length} required input features match ${artifact.evaluation.modelName} (${artifact.evaluation.version}). Ready to score current customers.`
        : compatible
          ? `Matched ${matchedFeatures.length} of ${requiredFeatures.length} model features. ${missingFeatures.length} missing column(s) (${missingFeatures.slice(0, 4).join(', ')}) will fall back to training medians/modes unless mapped.`
          : `Incompatible schema: missing ${missingFeatures.length} of ${requiredFeatures.length} features required by ${artifact.evaluation.modelName} (${artifact.evaluation.version}).`,
  };
}

const VALID_CHURN_STATUS_TOKENS = new Set([
  'churned',
  'retained',
  'unknown',
  'yes',
  'no',
  '1',
  '0',
  'true',
  'false',
  'stayed',
  'exited',
  'active',
  'cancelled',
  'canceled',
  'lapsed',
  'dropped',
  'discontinued',
]);

function checkSatisfactionBounds(
  val: number,
  scale: SatisfactionScale
): { valid: boolean; reason?: string } {
  if (scale === '1-5' && (val < 1 || val > 5)) {
    return { valid: false, reason: `Satisfaction score ${val} outside 1–5 scale` };
  }
  if (scale === '1-10' && (val < 1 || val > 10)) {
    return { valid: false, reason: `Satisfaction score ${val} outside 1–10 scale` };
  }
  if (scale === '0-100' && (val < 0 || val > 100)) {
    return { valid: false, reason: `Satisfaction score ${val} outside 0–100 scale` };
  }
  if (scale === 'nps' && (val < -100 || val > 100)) {
    return { valid: false, reason: `NPS score ${val} outside -100 to +100 range` };
  }
  return { valid: true };
}

function escapeCsvCell(val: string): string {
  const s = String(val ?? '');
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function validateCustomerImportRows(params: {
  headers: string[];
  rows: Record<string, string>[];
  mapping: ColumnMapping;
  uploadPathway?: UploadPathway;
  uploadMode?: 'customer' | 'tickets';
  satisfactionScale?: SatisfactionScale;
  unmappedColumns?: string[];
  duplicateTicketIds?: number;
}): {
  report: RowValidationReport;
  validRowsOnly: Record<string, string>[];
  rejectedRowsCsv: string;
} {
  const {
    headers,
    rows,
    mapping,
    satisfactionScale = '1-5',
    unmappedColumns = [],
    duplicateTicketIds = 0,
  } = params;

  const idCol = mapping.idColumn;
  const emailCol = findHeader(headers, ['email', 'customer_email', 'contact_email']);
  const nameCol = findHeader(headers, ['customer_name', 'full_name', 'account_name', 'name']);
  const endDateCol = findHeader(headers, [
    'subscription_end_date',
    'contract_end_date',
    'end_date',
    'expiry_date',
  ]);
  const statusCol = mapping.statusColumn || findHeader(headers, ['customer_status', 'account_status', 'subscription_status']);
  const satCol = findHeader(headers, [
    'customer_satisfaction_score',
    'satisfaction_score',
    'csat_score',
    'csat',
    'nps_score',
    'nps',
  ]);
  const complaintsCol = findHeader(headers, ['total_complaints', 'complaints', 'complaint_count']);
  const ticketsCol = findHeader(headers, ['total_tickets_raised', 'tickets_raised', 'support_tickets', 'support_calls']);
  const resDaysCol = findHeader(headers, ['average_resolution_days', 'avg_resolution_days', 'resolution_time_days', 'resolution_days']);
  const revCol =
    mapping.monthlyChargesColumn ||
    findHeader(headers, ['total_revenue', 'annual_revenue', 'monthly_revenue', 'mrr', 'monthly_charges', 'revenue']);
  const tenureCol = mapping.tenureColumn;

  const dateColumns = headers.filter(
    (h) =>
      /(date|_at$|_dt$)/i.test(h) ||
      h === mapping.dateColumn ||
      h === mapping.observationDateColumn ||
      h === mapping.registrationDateColumn ||
      h === mapping.churnDateColumn
  );

  const nonNegativeCols = Array.from(
    new Set(
      [
        revCol,
        tenureCol,
        complaintsCol,
        ticketsCol,
        resDaysCol,
        findHeader(headers, ['open_tickets']),
        findHeader(headers, ['resolved_tickets']),
        findHeader(headers, ['unresolved_tickets']),
        findHeader(headers, ['total_revenue']),
        findHeader(headers, ['annual_revenue']),
        findHeader(headers, ['monthly_revenue']),
        findHeader(headers, ['purchase_frequency']),
      ].filter((x): x is string => Boolean(x))
    )
  );

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const seenCustomerIds = new Set<string>();
  const issueCounter = new Map<string, { count: number; severity: 'warning' | 'error' }>();
  const bumpIssue = (label: string, severity: 'warning' | 'error') => {
    const prev = issueCounter.get(label);
    if (prev) {
      prev.count++;
    } else {
      issueCounter.set(label, { count: 1, severity });
    }
  };

  let validCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  let duplicateCustomerIds = 0;
  let missingValuesCount = 0;
  const nowTs = Date.now();

  const rowErrors: RowValidationIssue[] = [];
  const previewRecords: RowValidationPreviewItem[] = [];
  const validRowsOnly: Record<string, string>[] = [];
  const rejectedRows: { row: Record<string, string>; reason: string }[] = [];

  rows.forEach((row, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const h of headers) {
      if (isMissingValue(row[h])) {
        missingValuesCount++;
      }
    }

    let custIdDisplay = `ROW-${idx + 1}`;
    if (idCol) {
      const rawId = String(row[idCol] || '').trim();
      if (isMissingValue(rawId)) {
        errors.push(`Missing required ${idCol}`);
        bumpIssue('Missing Customer_ID', 'error');
      } else {
        custIdDisplay = rawId;
        const lowerId = rawId.toLowerCase();
        if (seenCustomerIds.has(lowerId)) {
          duplicateCustomerIds++;
          errors.push(`Duplicate ${idCol} "${rawId}"`);
          bumpIssue('Duplicate Customer_ID', 'error');
        } else {
          seenCustomerIds.add(lowerId);
        }
      }
    }

    if (emailCol) {
      const emailVal = String(row[emailCol] || '').trim();
      if (!isMissingValue(emailVal) && !emailRegex.test(emailVal)) {
        warnings.push(`Invalid email format "${emailVal}"`);
        bumpIssue('Invalid Email format', 'warning');
      }
    }

    for (const dCol of dateColumns) {
      const dVal = String(row[dCol] || '').trim();
      if (!isMissingValue(dVal) && !isValidIsoOrStandardDate(dVal)) {
        warnings.push(`Unparseable date in ${dCol}: "${dVal}"`);
        bumpIssue(`Invalid date format (${dCol})`, 'warning');
      }
    }

    for (const nCol of nonNegativeCols) {
      const rawN = row[nCol];
      if (!isMissingValue(rawN)) {
        const parsed = parseNumericStrict(rawN);
        if (parsed === null) {
          errors.push(`Non-numeric value in ${nCol}: "${rawN}"`);
          bumpIssue(`Invalid numeric value (${nCol})`, 'error');
        } else if (parsed < 0) {
          errors.push(`Negative value in ${nCol}: ${parsed}`);
          bumpIssue(`Negative numeric value (${nCol})`, 'error');
        }
      }
    }

    if (satCol && !isMissingValue(row[satCol])) {
      const satVal = parseNumericStrict(row[satCol]);
      if (satVal === null) {
        warnings.push(`Non-numeric satisfaction score "${row[satCol]}"`);
        bumpIssue('Invalid satisfaction score', 'warning');
      } else {
        const check = checkSatisfactionBounds(satVal, satisfactionScale);
        if (!check.valid) {
          warnings.push(check.reason!);
          bumpIssue(`Satisfaction outside ${satisfactionScale} scale`, 'warning');
        }
      }
    }

    if (mapping.targetColumn && !isMissingValue(row[mapping.targetColumn])) {
      const targetVal = String(row[mapping.targetColumn]).trim().toLowerCase();
      if (!VALID_CHURN_STATUS_TOKENS.has(targetVal)) {
        warnings.push(`Unrecognized Churn_Status "${row[mapping.targetColumn]}"`);
        bumpIssue('Invalid Churn_Status label', 'warning');
      }
    }

    // Past Subscription_End_Date while marked Active -> WARNING only (never auto-marked churned)
    if (endDateCol && statusCol) {
      const endStr = String(row[endDateCol] || '').trim();
      const statusStr = String(row[statusCol] || '').trim().toLowerCase();
      if (endStr && isValidIsoOrStandardDate(endStr) && statusStr === 'active') {
        if (Date.parse(endStr) < nowTs) {
          warnings.push(
            `Subscription_End_Date (${endStr}) is in the past while Customer_Status is Active — review renewal status`
          );
          bumpIssue('Past Subscription_End_Date with Active status', 'warning');
        }
      }
    }

    const rowStatus: 'Valid' | 'Warning' | 'Error' =
      errors.length > 0 ? 'Error' : warnings.length > 0 ? 'Warning' : 'Valid';

    if (rowStatus === 'Error') {
      errorCount++;
      const combined = [...errors, ...warnings];
      rejectedRows.push({ row, reason: combined.join(' | ') });
      if (rowErrors.length < 150) {
        rowErrors.push({
          rowIndex: idx + 1,
          customerId: custIdDisplay,
          status: 'error',
          messages: combined,
        });
      }
    } else if (rowStatus === 'Warning') {
      warningCount++;
      validRowsOnly.push(row);
      if (rowErrors.length < 150) {
        rowErrors.push({
          rowIndex: idx + 1,
          customerId: custIdDisplay,
          status: 'warning',
          messages: warnings,
        });
      }
    } else {
      validCount++;
      validRowsOnly.push(row);
    }

    if (previewRecords.length < 25) {
      previewRecords.push({
        rowIndex: idx + 1,
        customerId: custIdDisplay,
        customerName: nameCol && !isMissingValue(row[nameCol]) ? String(row[nameCol]).trim() : '—',
        subscriptionStatus:
          statusCol && !isMissingValue(row[statusCol]) ? String(row[statusCol]).trim() : '—',
        tenure: tenureCol && !isMissingValue(row[tenureCol]) ? String(row[tenureCol]).trim() : '—',
        satisfactionScore:
          satCol && !isMissingValue(row[satCol]) ? String(row[satCol]).trim() : '—',
        complaints:
          complaintsCol && !isMissingValue(row[complaintsCol])
            ? String(row[complaintsCol]).trim()
            : '—',
        ticketsRaised:
          ticketsCol && !isMissingValue(row[ticketsCol]) ? String(row[ticketsCol]).trim() : '—',
        avgResolutionTime:
          resDaysCol && !isMissingValue(row[resDaysCol]) ? `${String(row[resDaysCol]).trim()}d` : '—',
        revenue: revCol && !isMissingValue(row[revCol]) ? String(row[revCol]).trim() : '—',
        churnStatus:
          mapping.targetColumn && !isMissingValue(row[mapping.targetColumn])
            ? String(row[mapping.targetColumn]).trim()
            : 'Unlabeled',
        validationStatus: rowStatus,
        validationNotes: [...errors, ...warnings],
      });
    }
  });

  // Build CSV of rejected rows with Validation_Errors column
  let rejectedRowsCsv = '';
  if (rejectedRows.length > 0) {
    const outHeaders = ['Row_Number', ...headers, 'Validation_Errors'];
    const lines = [outHeaders.map(escapeCsvCell).join(',')];
    rejectedRows.forEach((rej, idx) => {
      const vals = [
        String(idx + 1),
        ...headers.map((h) => String(rej.row[h] ?? '')),
        rej.reason,
      ];
      lines.push(vals.map(escapeCsvCell).join(','));
    });
    rejectedRowsCsv = lines.join('\n');
  }

  const mappedCoreFields = [
    mapping.idColumn,
    mapping.targetColumn,
    mapping.contractColumn,
    mapping.tenureColumn,
    mapping.monthlyChargesColumn,
    mapping.dateColumn,
    mapping.statusColumn,
    mapping.frequencyColumn,
  ].filter(Boolean).length;
  const mappedFieldsCount = mappedCoreFields + mapping.featureColumns.length;

  const issuesSummary = Array.from(issueCounter.entries()).map(([label, meta]) => ({
    label,
    count: meta.count,
    severity: meta.severity,
  }));

  return {
    report: {
      totalRows: rows.length,
      validCount,
      warningCount,
      errorCount,
      duplicateCustomerIds,
      duplicateTicketIds,
      missingValuesCount,
      mappedFieldsCount,
      unmappedColumns,
      issuesSummary,
      rowErrors,
      previewRecords,
      hasRejectedRowsCsv: rejectedRows.length > 0,
    },
    validRowsOnly,
    rejectedRowsCsv,
  };
}
