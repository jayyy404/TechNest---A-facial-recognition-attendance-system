import { checkIfAdminLoggedIn, confirmIfAdmin } from './admin';
import updateClock from './libs/clock';
import { $ } from './libs/element';
import { formatTo12Hour } from './libs/utilities';

let allLogs = [];
let allLogoutLogs = [];
let currentLogType = 'attendance'; // default to attendance logs

fetch('/api/get-state')
  .then((res) => res.json())
  .then(({ logs, logout_logs }) => {
    allLogs = logs || [];
    allLogoutLogs = logout_logs || [];
    renderLogs(currentLogType);
  });

function renderLogs(logType) {
  currentLogType = logType;
  const logsToShow = logType === 'attendance' ? allLogs : allLogoutLogs;
  
  // Update title
  const title = logType === 'attendance' ? 'Attendance Logs' : 'Logout Logs';
  $('#logsTitle').textContent = title;
  
  $('#logsTable').replaceChildren(
    ...logsToShow.map((log) => {
      // Map recognized flag to user-friendly status text
      const recognizedFlag = Number(log.recognized);
      let statusText;
      
      if (logType === 'attendance') {
        statusText = recognizedFlag === 1 ? 'Present' : 'Unrecognized';
      } else {
        statusText = recognizedFlag === 1 ? 'Logged Out' : 'Unrecognized';
      }

      const tr = $.create('tr');

      tr.innerHTML = `
        <td>${formatTo12Hour(log.time)}</td>
        <td>${log.name ?? ''}</td>
        <td>${log.user_id ?? ''}</td>
        <td>${statusText}</td>
      `;

      return tr;
    })
  );
}

// Set up log type filter dropdown
const logTypeFilter = $('#logTypeFilter');
if (logTypeFilter) {
  logTypeFilter.addEventListener('change', (e) => {
    renderLogs(e.target.value);
  });
}

checkIfAdminLoggedIn($('#adminModal'), () => {
  $('#logsContent').style.removeProperty('display');
});

/** Cancel button */
$('#admin-form .btn-cancel').onclick = () => {
  alert('Admin login attempt canceled. Redirecting to attendance.');
  window.location.href = '/attendance';
};
