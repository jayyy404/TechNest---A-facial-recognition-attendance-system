/**
 * A helper function for querying html elements.
 * @returns {HTMLElement}
 */
export function $(selector) {
  return document.querySelector(selector);
}

$.all = (selector) => document.querySelectorAll(selector);
$.create = document.createElement.bind(document);