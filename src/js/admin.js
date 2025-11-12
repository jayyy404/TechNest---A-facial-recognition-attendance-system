import { $ } from './libs/element';

/**
 * This is an example of an [asynchronous function](https://www.w3schools.com/js/js_async.asp).
 * Learn more about it, it might help you in the long run!
 *
 * @param {HTMLFormElement} form The admin form element (use form elements, people!)
 * @param {() => void} onconfirm The action you want to do once the password is correct
 */
export async function confirmIfAdmin(form, onconfirm) {
  // We have to get the password from the server (for security purposes)
  // It is insecure to place your passwords and credentials on your source code.

  const password = new FormData(form).get('password');
  const isCorrectPassword = await fetch(
    `/api/validate-admin-password?password=${password}`
  ).then((res) => res.text()) === "true";

  if (!isCorrectPassword) {
    alert('Access denied. Password is incorrect.');
    return;
  }

  form.reset();
  onconfirm();
}

/**
 * This function checks if admin has not entered their password.
 * If not, show the modal.
 * @param {HTMLElement} modalElement
 */
export async function checkIfAdminLoggedIn(modalElement, onconfirm) {
  const form = $('#admin-form');

  // Only show the modal if it's currently hidden (avoid accidental assignment)
  try {
    if (modalElement && modalElement.style && modalElement.style.display === 'none') {
      modalElement.style.removeProperty('display');
    }
  } catch (e) {
    // ignore
  }

  if (!form) return;

  /**
   * See this function here? It is an example of an arrow function.
   * Arrow functions `(params) => { }` are shortened versions of the syntax `function(params) { }`.
   * The tradeback here, is that they don't have their own `this` keyword,
   * and inherits that of the function that encloses it (which is not needed in most cases).
   */
  form.onsubmit = (e) => {
    e.preventDefault();

    confirmIfAdmin(form, () => {
      $('#adminModal').style.display = 'none';
      onconfirm();
    });
  };

  /** Cancel button */
  $('#admin-form .btn-cancel').onclick = () => {
    alert('Admin login attempt canceled. Redirecting to attendance.');
    window.location.href = '/attendance';
  };
}
