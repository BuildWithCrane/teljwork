export function safePercent(usedBytes, capBytes) {
  const used = Number.isFinite(usedBytes) ? Math.max(0, usedBytes) : 0;
  const cap = Number.isFinite(capBytes) ? Math.max(0, capBytes) : 0;
  if (cap <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / cap) * 100)));
}

export function bytesToGB(bytes) {
  const n = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  return n / 1024 ** 3;
}

export function isUnlimitedStorage(bytes) {
  return Number.isFinite(bytes) && Number(bytes) < 0;
}

export function formatStorageAmount(bytes) {
  if (isUnlimitedStorage(bytes)) return 'Unlimited';
  const n = Number.isFinite(bytes) ? Math.max(0, Number(bytes)) : 0;
  const units = [
    { label: 'TB', size: 1024 ** 4 },
    { label: 'GB', size: 1024 ** 3 },
    { label: 'MB', size: 1024 ** 2 },
    { label: 'KB', size: 1024 },
  ];
  for (const unit of units) {
    if (n >= unit.size) return `${(n / unit.size).toFixed(2)} ${unit.label}`;
  }
  return `${n.toFixed(0)} B`;
}

export function getFileType(name = '') {
  const ext = String(name).toLowerCase().split('.').pop();
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'aac', 'flac'].includes(ext)) return 'audio';
  return 'other';
}

export function isPreviewableFile(file = {}) {
  const mime = String(file?.type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (mime) return false;
  return getFileType(file?.name || '') === 'image';
}

export function filterAndSortFiles(files = [], options = {}) {
  const {
    query = '',
    type = 'all',
    sortBy = 'uploaded_desc',
  } = options;

  const q = String(query).trim().toLowerCase();
  let out = files.filter((f) => {
    if (!f || typeof f.name !== 'string') return false;
    const matchesQuery = !q || f.name.toLowerCase().includes(q);
    const matchesType = type === 'all' || getFileType(f.name) === type;
    return matchesQuery && matchesType;
  });

  out.sort((a, b) => {
    if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
    if (sortBy === 'name_desc') return b.name.localeCompare(a.name);
    if (sortBy === 'size_asc') return (a.size || 0) - (b.size || 0);
    if (sortBy === 'size_desc') return (b.size || 0) - (a.size || 0);
    if (sortBy === 'uploaded_asc') return new Date(a.uploaded_at || 0) - new Date(b.uploaded_at || 0);
    return new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0);
  });

  return out;
}

export function paginate(items = [], page = 1, pageSize = 10) {
  const safeSize = Math.max(1, Number(pageSize) || 10);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / safeSize));
  const currentPage = Math.min(pages, Math.max(1, Number(page) || 1));
  const start = (currentPage - 1) * safeSize;
  return {
    page: currentPage,
    pageSize: safeSize,
    pages,
    total,
    items: items.slice(start, start + safeSize),
  };
}
