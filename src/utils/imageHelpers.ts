import type { UserRole } from '../types/churn';

export function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'CS';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function formatRoleLabel(role: UserRole): string {
  if (role === 'PLATFORM_OWNER') return 'PLATFORM OWNER';
  return role === 'FIRM_ADMIN' ? 'FIRM ADMIN' : 'ANALYST';
}

export async function readAndCompressImageFile(file: File, maxSizePx = 320): Promise<string> {
  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) {
    throw new Error('Please choose a PNG, JPG, WEBP, or GIF image file.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Selected image must be smaller than 5 MB.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onerror = () => reject(new Error('The selected file could not be decoded as an image.'));
      img.onload = () => {
        const scale = Math.min(1, maxSizePx / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const compressed = canvas.toDataURL(outputType, 0.86);
        resolve(compressed);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
