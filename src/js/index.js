import { relativeDate } from './libs/utilities';
import { $ } from './libs/element';
import {
  Chart,
  LineController,
  BarController,
  LineElement,
  BarElement,
  Filler,
  LinearScale,
  CategoryScale,
} from 'chart.js';
import { checkIfAdminLoggedIn, confirmIfAdmin } from './admin';
import updateClock from './libs/clock';

const data = {
  users: [],
  logs: [],
  redirectUrl: null,
  currentSection: null,
  attendanceChart: null,
  chartType: 'bar',
};

/** Apparently, we still have to initialize chart.js so we import it */
Chart.register(
  LinearScale,
  CategoryScale,
  LineController,
  BarController,
  LineElement,
  BarElement,
  Filler
);

async function loadState() {
  // ------------------------------------------------------------------------------------
  // I'LL KEEP THE ORIGINAL CODE FOR REFERENCE, JUST IN CASE YOU GET CONFUSED.
  // If you're wondering, you can shorten this entire thing way easier.
  // ------------------------------------------------------------------------------------
  // const res = await fetch('index.php?action=get_state');
  // const data = await res.json();
  // USERS = data.users;
  // LOGS = data.logs;
  // refreshDashboard();

  const { users, logs } = await fetch('/api/get-state').then((res) =>
    res.json()
  );

  data.users = users;
  data.logs = logs;

  updateDashboard();
}

// function refreshDashboard() {
function updateDashboard() {
  /* document.getElementById('totalUsers').innerText = USERS.length;

  const today = new Date().toISOString().slice(0, 10);
  const thisWeek = new Date();
  thisWeek.setDate(thisWeek.getDate() - 7);
  const thisMonth = new Date();
  thisMonth.setDate(thisMonth.getDate() - 30);

  let todayLogs = LOGS.filter((l) => l.time.startsWith(today));
  let weekLogs = LOGS.filter((l) => new Date(l.time) >= thisWeek);
  let monthLogs = LOGS.filter((l) => new Date(l.time) >= thisMonth);

  document.getElementById('todayAttendance').innerText = todayLogs.filter(
    (l) => l.recognized == 1
  ).length;
  document.getElementById('unrecogAttempts').innerText = todayLogs.filter(
    (l) => l.recognized == 0
  ).length;

  // Attendance Rates
  const totalToday = todayLogs.length;
  const totalWeek = weekLogs.length;
  const totalMonth = monthLogs.length;
  const rateToday = totalToday
    ? Math.round(
        (todayLogs.filter((l) => l.recognized == 1).length / totalToday) * 100
      )
    : 0;
  const rateWeek = totalWeek
    ? Math.round(
        (weekLogs.filter((l) => l.recognized == 1).length / totalWeek) * 100
      )
    : 0;
  const rateMonth = totalMonth
    ? Math.round(
        (monthLogs.filter((l) => l.recognized == 1).length / totalMonth) * 100
      )
    : 0;

  document.getElementById('rateToday').innerText = rateToday + '%';
  document.getElementById('rateWeek').innerText = rateWeek + '%';
  document.getElementById('rateMonth').innerText = rateMonth + '%';

  // Update Chart
  updateChart([rateToday, rateWeek, rateMonth]);

  // Recent Users
  const tbody = document.getElementById('userTable');
  tbody.innerHTML = '';
  USERS.slice(0, 5).forEach((u) => {
    let tr = document.createElement('tr');
    tr.innerHTML = `<td>${u.name}</td><td>${u.id}</td><td>${u.role}</td>`;
    tbody.appendChild(tr);
  }); */

  const elements = {
    totalUsers: $('#totalUsers'),
  };

  elements.totalUsers.innerText = data.users.length;

  // ------------------------------------------------------------------------------------
  // TIME
  // ------------------------------------------------------------------------------------
  const now = new Date();
  const thisWeek = relativeDate(-7);
  const thisMonth = relativeDate(-30);

  /**
   * A helper function that splits the logs into recognized and unrecognized entries
   */
  function splitIntoRecognizedUnrecognized(logs) {
    return data.logs.reduce(
      (prev, cur) => {
        if (cur.recognized) {
          prev.recognized.push(cur);
        } else {
          prev.unrecognized.push(cur);
        }

        return prev;
      },
      { recognized: [], unrecognized: [] }
    );
  }

  /** Get the logs, filtered by daily, weekly, or monthly */
  const logsFilteredByDate = {
    today: splitIntoRecognizedUnrecognized(
      data.logs.filter((l) => l.time.startsWith(now.toISOString().slice(0, 10)))
    ),
    week: splitIntoRecognizedUnrecognized(
      data.logs.filter((l) => new Date(l.time).getTime() >= thisWeek.getTime())
    ),
    month: splitIntoRecognizedUnrecognized(
      data.logs.filter((l) => new Date(l.time).getTime() >= thisMonth.getTime())
    ),
  };

  // ------------------------------------------------------------------------------------
  // Replace the attendance entries by the fetched data,
  // categorized into unrecognized and recognized entries
  // ------------------------------------------------------------------------------------
  $('#todayAttendance').innerText = logsFilteredByDate.today.recognized.length;
  $('#unrecogAttempts').innerText =
    logsFilteredByDate.today.unrecognized.length;

  // ------------------------------------------------------------------------------------
  // Attendance Totals
  // If you're wondering, the `Object.values().flat()` thingy is just a shortcut of the line
  // below. Note that this is already advanced Javascript, so you should take time
  // to look it up before using this on your own. I'll just use this to save time.
  // ------------------------------------------------------------------------------------

  /* const todayLoginTotal = logsFilteredByDate.today.recognized + logsFilteredByDate.today.unrecognized; */
  const todayAttendanceTotal = [
    ...Object.values(logsFilteredByDate.today),
  ].flat(1).length;
  const weeklyAttendanceTotal = [
    ...Object.values(logsFilteredByDate.week),
  ].flat(1).length;
  const monthlyAttendanceTotal = [
    ...Object.values(logsFilteredByDate.month),
  ].flat(1).length;

  /**
   * Calculate percentage
   * (total || 1) is a small trick you can do to replicate the implementation you were doing prior
   */
  const todayAttendanceRate = Math.round(
    (logsFilteredByDate.today.recognized / (todayAttendanceTotal || 1)) * 100
  );
  const weeklyAttendanceRate = Math.round(
    (logsFilteredByDate.week.recognized / (weeklyAttendanceTotal || 1)) * 100
  );
  const monthlyAttendanceRate = Math.round(
    (logsFilteredByDate.month.recognized / (monthlyAttendanceTotal || 1)) * 100
  );

  /** Apply to elements */
  $('#rateToday').innerText = `${todayAttendanceRate}%`; // use string interpolation! It works much better than concatenating strings (+)
  $('#rateWeek').innerText = `${weeklyAttendanceRate}%`;
  $('#rateMonth').innerText = `${monthlyAttendanceRate}%`;

  /** Update chart */
  updateChart(todayAttendanceRate, weeklyAttendanceRate, monthlyAttendanceRate);

  /** Recent attendance logs */
  const table = $('#userTable');
  table.innerHTML = '';

  /** Map users to the table */
  data.users.forEach((user) => {
    const tr = document.createElement('tr');

    // Instead of using a long string here, just use map() and join() so that it's cleaner
    tr.innerHTML = [user.name, user.id, user.role]
      .map((item) => `<td>${item}</td>`)
      .join('\n');

    table.append(tr);
  });
}

/** Update the displayed chart */
function updateChart(...attendanceData) {
  // Canvas context
  const ctx = $('#attendanceChart').getContext('2d');

  // Destroy the chart if it exists
  // if (data.attendanceChart) data.attendanceChart.destroy();

  /**
   * Did you know? Instead of an if statement,
   * we can use the optional chaining operator `?.`.
   */
  data.attendanceChart?.destroy();

  // Create the chart
  data.attendanceChart = new Chart(ctx, {
    type: data.chartType,
    data: {
      labels: ['Today', 'This Week', 'This Month'],
      datasets: [
        {
          label: 'Attendance Rate (%)',
          data: attendanceData,
          backgroundColor: ['#1d4ed8', '#10b981', '#f59e0b'],
          borderColor: '#fff',
          borderWidth: 2,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, max: 100 } },
    },
  });
}

function setChartType(type) {
  data.chartType = type;
  // refreshDashboard();
  updateDashboard();
}

function downloadChart() {
  const link = document.createElement('a');
  link.href = data.attendanceChart.toBase64Image();
  link.download = 'attendance_chart.png';
  link.click();
}

updateClock();

/**
 *  --------------------------------------------------------------------------------------------
 * ### Developer's notes:
 *
 * I will be restructuring this entire section for several reasons:
 *  - You are overriding the default behavior of links to requiring admin approval,
 *    and still requiring the user password once you navigate, causing admin
 *    authentication to happen twice, which is not ideal.
 *  - All the code is copy-pasted from one file to another. Yes, this works short-term,
 *    but it will make your code harder to understand in the long run.
 *  - You are re-editing text every time you open the modal. Why not just add the text
 *    or clear the form every time you submit?
 *
 *  So, in order to make your lives easier, here's the list of what I will change:
 *  - Move all the authentication code to a separate file, and then import it here
 *  - Remove the functionality that blocks links, authentication is done on navigation instead.
 *  - Autosave the functionality on a cookie so that users don't have to re-enter the password
 *    on navigation. We'll set the timeout to just session, so that it expires once the user
 *    exits.
 *  - Add an error on closeModal() because you are not supposed to escape the admin login
 *  - Instead of calling javascript functions inside the html, we reference the html on
 *    the javascript side and then attach the onclick from there. Calling functions inside the
 *    HTML is old behavior and is inconsistent, and so should not be used.
 *  - remove the onload() function as it's unneccessary. These values are already initialized
 *    like this on startup.
 *
 *  --------------------------------------------------------------------------------------------
 */

/* // Lock Sections
// $.all('.restricted').forEach((link) => {
//   link.addEventListener('click', function (e) {
//     e.preventDefault();
//     redirectUrl = this.getAttribute('href');
//     currentSection = this.dataset.section || 'Admin Area';
//     document.getElementById(
//       'modalTitle'
//     ).innerText = `🔒 ${currentSection} - Admin Confirmation`;
//     document.getElementById('adminPass').value = '';
//     document.getElementById('adminModal').style.display = 'flex';
//   });
// });

// Dashboard lock on load
// window.onload = function () {
//   redirectUrl = 'index.php';
//   currentSection = 'Dashboard';
//   document.getElementById(
//     'modalTitle'
//   ).innerText = `🔒 Dashboard - Admin Confirmation`;
//   document.getElementById('adminPass').value = '';
//   document.getElementById('adminModal').style.display = 'flex';

//   // 🔄 Auto-refresh chart & stats every 60 seconds after unlock
//   setInterval(() => {
//     if (document.getElementById('dashboardContent').style.display === 'block') {
//       loadState();
//     }
//   }, 60000); // 60000ms = 1 minute
// };

// function closeModal() {
//   document.getElementById('adminModal').style.display = 'none';
//   document.getElementById('adminPass').value = '';
//   redirectUrl = null;
//   currentSection = null;
// }

// function confirmAdmin() {
//   const pass = document.getElementById('adminPass').value;
//   if (pass === '12345') {
//     document.getElementById('adminModal').style.display = 'none';
//     document.getElementById('adminPass').value = '';
//     if (redirectUrl === 'index.php') {
//       document.getElementById('dashboardContent').style.display = 'block';
//       loadState();
//     } else {
//       window.location.href = redirectUrl;
//     }
//   } else {
//     alert('Access denied. Invalid Admin password.');
//   }
// }
 */

checkIfAdminLoggedIn($('#adminModal'), () => {
  $('#dashboardContent').style.removeProperty('display');

  loadState();
  updateClock();
});

/** Set chart type button */
$('#set-chart-type-bar').onclick = () => setChartType('bar');
$('#set-chart-type-line').onclick = () => setChartType('line');
$('#download-chart').onclick = () => downloadChart();
