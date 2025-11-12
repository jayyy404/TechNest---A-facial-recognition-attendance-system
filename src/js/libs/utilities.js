/** 
 * Minimalistic date function for relative dates 
 * Implementation still the same, just moved the logic to 
 * a different folder for easy access
 */
export function relativeDate(days ,date = new Date()) {
  date.setDate(date.getDate() + days);
  return date;
}