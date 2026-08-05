// Wrap all initialization to ensure DOM elements exist
document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  // Tabs
  const panels = document.querySelectorAll('.tab-panel');
  function showPanel(name) {
    panels.forEach(p => p.classList.add('hidden'));
    const el = $('panel-' + name);
    if (el) el.classList.remove('hidden');
  }

  function setActive(id){
    // only toggle tab buttons (avoid removing classes from other buttons)
    document.querySelectorAll('#tab-dynamic, #tab-softpos, #tab-static').forEach(b=>b.classList.remove('bg-blue-500','text-white'));
    const btn = $(id);
    if (btn) btn.classList.add('bg-blue-500','text-white');
  }

  // Hook tab buttons
  const tabDyn = $('tab-dynamic');
  const tabSoft = $('tab-softpos');
  const tabStatic = $('tab-static');
  if (tabDyn) tabDyn.addEventListener('click', () => { showPanel('dynamic'); setActive('tab-dynamic'); });
  if (tabSoft) tabSoft.addEventListener('click', () => { showPanel('softpos'); setActive('tab-softpos'); });
  if (tabStatic) tabStatic.addEventListener('click', () => { showPanel('static'); setActive('tab-static'); });

  // Initialize default tab
  showPanel('dynamic');
  setActive('tab-dynamic');

  // Dynamic QR
  const dynSend = $('dyn-send');
  if (dynSend) dynSend.addEventListener('click', async () => {
    const amount = $('dyn-amount').value;
    const resultEl = $('dyn-result');
    if (resultEl) resultEl.innerText = 'Generating...';
    try {
      const res = await fetch('/api/dynamic-qr', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ amount }) });
      const data = await res.json();
      if (!res.ok) throw data;
      if (resultEl) resultEl.innerHTML = `<div>Order ID: ${data.order_id}</div><div id="qr-container"></div>`;
      const container = document.getElementById('qr-container');
      if (container) container.innerHTML = '';
      // render image if dataUrl available
      if (data.qrDataUrl && container) {
        const img = document.createElement('img'); img.src = data.qrDataUrl; img.alt = 'QR'; img.className='mt-2';
        container.appendChild(img);
      } else if (data.qrString && container) {
        new QRCode(container, data.qrString);
      }
    } catch (e) {
      console.error(e);
      if (resultEl) resultEl.innerText = 'Error: ' + (e.error || e.message || JSON.stringify(e));
    }
  });

  // SoftPOS push
  const softSend = $('soft-send');
  if (softSend) softSend.addEventListener('click', async () => {
    const amount = $('soft-amount').value;
    const phone = $('soft-phone').value;
    const terminal_id = $('soft-terminal').value;
    const statusEl = $('soft-status');
    if (statusEl) statusEl.innerText = 'Pushing transaction...';
    try {
      const res = await fetch('/api/push-softpos', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ amount, phone, terminal_id }) });
      const data = await res.json();
      if (!res.ok) throw data;
      if (statusEl) statusEl.innerHTML = `Pushed. Order ID: ${data.order_id}. Waiting for agent approval...`;
      // Poll for status
      const orderId = data.order_id;
      const poll = setInterval(async () => {
        try {
          const sres = await fetch('/api/order-status?order_id=' + encodeURIComponent(orderId));
          const sdata = await sres.json();
          if (sdata.status && sdata.status !== 'PENDING_PUSH') {
            if (statusEl) statusEl.innerHTML = `Final status: ${sdata.status}`;
            clearInterval(poll);
          }
        } catch (err) {
          console.error('poll error', err);
          // keep polling; optionally stop after N attempts
        }
      }, 3000);
    } catch (e) {
      console.error(e);
      if (statusEl) statusEl.innerText = 'Error: ' + (e.error || e.message || JSON.stringify(e));
    }
  });

  // Static QR render
  const vpaEl = $('merchant-vpa');
  const staticContainer = $('static-qr');
  if (vpaEl && staticContainer) {
    const vpa = vpaEl.innerText || 'merchant@upi';
    const name = 'Merchant';
    const upi = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(name)}&cu=INR`;
    staticContainer.innerHTML = '';
    new QRCode(staticContainer, upi);
  }

});
