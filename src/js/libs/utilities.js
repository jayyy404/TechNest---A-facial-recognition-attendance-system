/** 
 * Minimalistic date function for relative dates 
 * Implementation still the same, just moved the logic to 
 * a different folder for easy access
 */
export function relativeDate(days ,date = new Date()) {
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Format timestamp to 12-hour clock format with AM/PM
 * @param {string|Date} timestamp - ISO string or Date object
 * @returns {string} Formatted time (e.g., "2:30:45 PM")
 */
export function formatTo12Hour(timestamp) {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    second: '2-digit', 
    hour12: true 
  });
}
