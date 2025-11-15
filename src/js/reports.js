import { $ } from './libs/element';
import updateClock from './libs/clock';
import { checkIfAdminLoggedIn } from './admin';

let currentReportType = 'attendance'; // Track current report type for export

function showReport(id, fn) {
  $.all('.report-section').forEach((div) => div.classList.remove('active'));
  $(`#${id}`).classList.add('active');
  window.scrollTo(0, 0);

  fn();
}

$('#show-report-monthly-attendance').onclick = () => {
  currentReportType = 'attendance';
  showReport('monthly', fetchMonthly);
};

$('#show-report-monthly-logout').onclick = () => {
  currentReportType = 'logout';
  showReport('monthly-logout', fetchMonthlyLogout);
};

$('#show-report-custom').onclick = () => showReport('custom', customReportGeneration);
$('#show-report-summary').onclick = () => showReport('summary', fetchSummary);
$('#show-report-exceptions').onclick = () => showReport('exceptions', fetchExceptions);
$('#show-report-individual').onclick = () => showReport('individual', fetchIndividualUser);

// Export CSV buttons
$('#export-csv-monthly').onclick = () => exportCSV('attendance');
$('#export-csv-logout').onclick = () => exportCSV('logout');

function exportCSV(type) {
  window.location.href = `/api/export-csv?type=${type}`;
}

updateClock();


const params = new URLSearchParams(location.search);

if (params.has('userId')) {
  showReport('individual', fetchIndividualUser);
} else if (params.has('from') || params.has('to')) {
  showReport('custom', customReportGeneration);
} else {
  showReport('monthly', fetchMonthly);
}



function renderData(reportData, columns, displayColumns, container) {
  // Check if columns and displayColumns check out
  if (columns.length !== displayColumns.length) {
    throw new Error(
      `Data column length is not equal to display column length! \nAt data: ${columns.length}\nAt display: ${displayColumns.length}`
    );
  }

  const table = $.create('table');
  const thead = $.create('thead');
  const tbody = $.create('tbody');

  table.append(thead, tbody);

  thead.innerHTML = `
    <tr>
      ${displayColumns.map(col => `<th>${col}</th>`).join('\n')}
    </tr>
  `

  tbody.replaceChildren(
    ...reportData.map(row => {
      const el = $.create('tr');

      el.innerHTML = 
        columns.map(col => `<td>${row[col]}</td>`).join('\n');

      return el;
    })
  );


  container.replaceChildren(table);
}

async function fetchMonthly() {
  const monthlyReport = await fetch('/api/reports/monthly-report').then(res => res.json());

  if (monthlyReport.length === 0) {
    $('#monthly .data').innerHTML = `<p>No attendance records found.</p>`;
    return;
  }

  renderData(
    monthlyReport,
    ['user_id', 'name', 'role', 'dept', 'month', 'status'],
    ['User ID', 'Name', 'Role', 'Dept', 'Month', 'Status'],
    $('#monthly .data')
  );  
}

async function fetchMonthlyLogout() {
  const monthlyReport = await fetch('/api/reports/monthly-logout-report').then(res => res.json());

  if (monthlyReport.length === 0) {
    $('#monthly-logout .data').innerHTML = `<p>No logout records found.</p>`;
    return;
  }

  const table = $.create('table');
  const thead = $.create('thead');
  const tbody = $.create('tbody');

  table.append(thead, tbody);

  thead.innerHTML = `
    <tr>
      <th>User ID</th>
      <th>Name</th>
      <th>Role</th>
      <th>Dept</th>
      <th>Month</th>
      <th>Status</th>
    </tr>
  `;

  tbody.replaceChildren(
    ...monthlyReport.map(row => {
      const el = $.create('tr');
      
      // If not recognized, show blank for user details
      const user_id = row.recognized ? row.user_id : '';
      const name = row.recognized ? row.name : '';
      const role = row.recognized ? row.role : '';
      const dept = row.recognized ? row.dept : '';
      
      el.innerHTML = `
        <td>${user_id}</td>
        <td>${name}</td>
        <td>${role}</td>
        <td>${dept}</td>
        <td>${row.month}</td>
        <td>${row.status}</td>
      `;

      return el;
    })
  );

  $('#monthly-logout .data').replaceChildren(table);
}

async function customReportGeneration() {
  const data = await fetch('/api/reports/data').then(res => res.json());
  const form = $('#custom form');
  
  updateCustomReportUI();
  form.onchange = updateCustomReportUI;

  function updateCustomReportUI() {
    const { from, to } = Object.fromEntries(new FormData(form).entries());

    const filteredData = data.filter(row => {
      const date = new Date(row.date);
      return date >= new Date(from) && date <= new Date(to);
    });

    if (filteredData.length === 0) {
      $('#custom .data').innerHTML = `<p>No attendance records found for the selected date range.</p>`;
      return;
    }

    renderData(
      filteredData, 
      ['date', 'user_id', 'name', 'role', 'dept', 'status'],
      ['Date', 'User ID', 'Name', 'Role', 'Dept', 'Status'],
      $('#custom .data')
    );  
  }
}

async function fetchSummary() {
  const { totalUsers, totalRecognized, totalUnrecognized, totalLogout }
    = await fetch("/api/reports/summary").then(res => res.json());

  $('#summary .total-registered').innerHTML = `Total Registered Users: <b>${totalUsers}</b>`;
  $('#summary .total-recognized-attendance').innerHTML = `Total Recognized Attendance: <b>${totalRecognized}</b>`;
  $('#summary .total-logout').innerHTML = `Total Logout: <b>${totalLogout}</b>`;
  $('#summary .total-unrecognized').innerHTML = `Total Unrecognized Attempts: <b>${totalUnrecognized}</b>`;
}

async function fetchExceptions() {
  const exceptions = (await fetch('/api/reports/data').then(res => res.json()))
    .filter(row => row.status === "unrecognized");

  if (exceptions.length === 0) {
    $('#exceptions .data').innerHTML = `<p>No exceptions found.</p>`;
    return;
  }

  renderData(
    exceptions, 
    ['date', 'user_id', 'name', 'role', 'dept', 'status'],
    ['Date', 'User ID', 'Name', 'Role', 'Dept', 'Status'],
    $('#exceptions .data')
  ); 
}

async function fetchIndividualUser() {
  const users = await fetch('/api/reports/get-user-list').then(res => res.json());
  const input = $('#user-id-search');
  const recordTypeBtn = $('#user-record-type-btn');
  const recordAttendanceLink = $('#user-record-attendance');
  const recordLogoutLink = $('#user-record-logout');
  
  let currentRecordType = 'attendance';
  let currentUser = null;
  
  updateExceptionReport();
  input.oninput = updateExceptionReport;

  // Handle dropdown menu clicks
  recordAttendanceLink.onclick = (e) => {
    e.preventDefault();
    currentRecordType = 'attendance';
    recordTypeBtn.textContent = 'Attendance Records ▼';
    if (currentUser) updateExceptionReport();
  };

  recordLogoutLink.onclick = (e) => {
    e.preventDefault();
    currentRecordType = 'logout';
    recordTypeBtn.textContent = 'Logout Records ▼';
    if (currentUser) updateExceptionReport();
  };

  async function updateExceptionReport() {
    const id = input.value;

    // If there is no input, indicate that user ID has to be entered.
    if (id.length === 0) {
      $('#individual .data').innerHTML = `<p>Input a user ID above to continue.</p>`;
      recordTypeBtn.style.display = 'none';
      currentUser = null;
      return;
    }
  

    const user = users.find(user => user.id === id);

    if (!user) {
      $('#individual .data').innerHTML = `<p>User ID <b>${id}</b> does not exist.</p>`;
      recordTypeBtn.style.display = 'none';
      currentUser = null;
      return;
    }

    currentUser = user;
    recordTypeBtn.style.display = 'inline-block';

    // Get user records based on selected type
    const endpoint = currentRecordType === 'attendance' 
      ? `/api/reports/get-user-attendance?id=${user.id}`
      : `/api/reports/get-user-logout?id=${user.id}`;

    const userRecordList = await fetch(endpoint).then(res => res.json());

    if (userRecordList.length === 0) {
      const recordTypeLabel = currentRecordType === 'attendance' ? 'attendance' : 'logout';
      $('#individual .data').innerHTML = `<p>User <b>${user.name}</b> (ID ${id}) exists but has no ${recordTypeLabel} records yet.</p>`;
      return;
    }

    renderData(
      userRecordList, 
      ['date', 'status'],
      ['Date', 'Status'],
      $('#individual .data')
    ); 

    const userInfo = $.create('p');
    const recordTypeLabel = currentRecordType === 'attendance' ? 'Attendance' : 'Logout';
    userInfo.innerHTML = `${recordTypeLabel} for <b>${user.name} (${user.id}) - Role: ${user.role} / Dept: ${user.dept}</b>`

    $('#individual .data').prepend(userInfo);
  }
}

checkIfAdminLoggedIn($('#adminModal'), () => {
  $('#reportsContent').style.removeProperty('display');
});