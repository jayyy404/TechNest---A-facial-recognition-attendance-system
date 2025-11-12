import { checkIfAdminLoggedIn } from './admin';
import { $ } from './libs/element';
import updateClock from './libs/clock';

updateClock();
checkIfAdminLoggedIn($('#adminModal'), () => {
  $('#settingsContent').style.removeProperty('display');
  updateSettings();
  updateEventListeners();
});

// Notification system (#alert-contents)

/**
 * All system updates have been moved from the PHP side to the Javascript side.
 */
async function updateSettings() {
  const settings = await fetch('/api/settings/get-settings').then((res) =>
    res.json()
  );
  // get roles removed — we no longer show account/roles sections

  function updateSystemSettings() {
    $('#system-settings [name="system_name"]').value = settings.system_name;
    $('#system-settings [name="institution"]').value = settings.institution;
    // default_camera selection will be applied after camera list is populated
    // (populateCameraList reads settings.default_camera to pre-select)
  }

  // populate system settings and camera list
  updateSystemSettings();
  await populateCameraList();
}

function updateEventListeners() {
  $('#system-settings').onsubmit = (e) => {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);

    fetch('/api/settings/updates/system', {
      method: 'POST',
      body: formData,
    }).then(async (res) => {
      if (res.ok) {
        updateSettings();
        $('.alert').style.removeProperty('display');
        $('#alert-contents').innerHTML = await res.text();
      }
    });
  };
}

async function populateCameraList() {
  // Create or find the select element inside system-settings
  const select = $('#system-settings [name="default_camera"]');

  // If browser supports mediaDevices, enumerate video input devices
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === 'videoinput');

      // Clear existing options and add placeholder option
      const options = cameras.map((cam) => {
        const opt = $.create('option');
        opt.value = cam.deviceId || cam.label || 'default';
        // If label is empty (no permission), show placeholder text
        opt.innerHTML = cam.label && cam.label.length > 0 ? cam.label : '— Camera name hidden (allow camera access to see title)';
        return opt;
      });

      // If there's no camera detected, keep a default option
      if (options.length === 0) {
        const opt = $.create('option');
        opt.value = 'default';
        opt.innerHTML = 'Default Camera';
        options.push(opt);
      }

      select.replaceChildren(...options);

      // Pre-select saved camera from settings if present
      try {
        const settings = await fetch('/api/settings/get-settings').then((res) => res.json());
        if (settings.default_camera) {
          const match = Array.from(select.options).find(o => o.value === settings.default_camera);
          if (match) match.selected = true;
        }
      } catch (err) {
        // ignore
      }
    } catch (err) {
      console.error('Failed to enumerate devices', err);
    }
  } else {
    // Fallback: single default option
    select.replaceChildren((() => {
      const opt = $.create('option');
      opt.value = 'default';
      opt.innerHTML = 'Default Camera';
      return opt;
    })());
  }
}
