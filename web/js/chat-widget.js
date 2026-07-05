// Floating Gemini chat widget for the public demo.
// Self-contained: injects its own DOM + styles, talks to POST /api/chat.
(function () {
  const style = document.createElement('style');
  style.textContent = `
    #aicChatFab { position: fixed; right: 22px; bottom: 22px; z-index: 9000;
      width: 54px; height: 54px; border-radius: 50%; border: none; cursor: pointer;
      background: var(--accent, #16a34a); color: #fff; font-size: 22px;
      box-shadow: 0 6px 18px rgba(0,0,0,.25); }
    #aicChatPanel { position: fixed; right: 22px; bottom: 88px; z-index: 9000;
      width: min(360px, calc(100vw - 32px)); height: 460px; max-height: 70vh;
      display: none; flex-direction: column; border-radius: 14px; overflow: hidden;
      background: var(--card, #ffffff); color: var(--text, #111827);
      border: 1px solid rgba(128,128,128,.25); box-shadow: 0 12px 40px rgba(0,0,0,.3); }
    body.dark-mode #aicChatPanel, .dark #aicChatPanel { background: var(--card, #111827); color: var(--text, #e5e7eb); }
    #aicChatPanel.open { display: flex; }
    #aicChatHead { padding: 12px 14px; font-weight: 700; background: var(--accent, #16a34a);
      color: #fff; display: flex; justify-content: space-between; align-items: center; }
    #aicChatHead small { font-weight: 400; opacity: .85; display: block; }
    #aicChatMsgs { flex: 1; overflow-y: auto; padding: 12px; display: flex;
      flex-direction: column; gap: 8px; font-size: .9rem; }
    .aic-msg { padding: 8px 12px; border-radius: 12px; max-width: 85%;
      white-space: pre-wrap; word-break: break-word; line-height: 1.4; }
    .aic-msg.user { align-self: flex-end; background: var(--accent, #16a34a); color: #fff; }
    .aic-msg.bot { align-self: flex-start; background: rgba(128,128,128,.15); }
    #aicChatForm { display: flex; gap: 8px; padding: 10px; border-top: 1px solid rgba(128,128,128,.25); }
    #aicChatInput { flex: 1; padding: 9px 12px; border-radius: 10px;
      border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit; }
    #aicChatSend { border: none; border-radius: 10px; padding: 9px 14px; cursor: pointer;
      background: var(--accent, #16a34a); color: #fff; font-weight: 600; }
  `;
  document.head.appendChild(style);

  const fab = document.createElement('button');
  fab.id = 'aicChatFab';
  fab.title = 'Ask the IC assistant';
  fab.textContent = '💬';

  const panel = document.createElement('div');
  panel.id = 'aicChatPanel';
  panel.innerHTML = `
    <div id="aicChatHead">
      <div>IC Assistant<small>Gemini-powered, rate-limited demo</small></div>
      <button style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;" id="aicChatClose">×</button>
    </div>
    <div id="aicChatMsgs">
      <div class="aic-msg bot">Hi! Ask me anything about counterfeit IC detection, this project's pipeline, or a specific chip. 👋</div>
    </div>
    <form id="aicChatForm">
      <input id="aicChatInput" autocomplete="off" placeholder="Ask about ICs…" maxlength="500" />
      <button id="aicChatSend" type="submit">Send</button>
    </form>`;

  document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(fab);
    document.body.appendChild(panel);

    const msgs = panel.querySelector('#aicChatMsgs');
    const input = panel.querySelector('#aicChatInput');
    const form = panel.querySelector('#aicChatForm');
    const sessionId = 'web_' + Math.random().toString(36).slice(2, 10);
    const history = [];

    function add(role, text) {
      const div = document.createElement('div');
      div.className = 'aic-msg ' + role;
      div.textContent = text;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
      return div;
    }

    fab.addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) input.focus();
    });
    panel.querySelector('#aicChatClose').addEventListener('click', () => panel.classList.remove('open'));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = input.value.trim();
      if (!message) return;
      input.value = '';
      add('user', message);
      history.push({ role: 'user', content: message });
      const pending = add('bot', '…');
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, session_id: sessionId, chat_history: history.slice(-10) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        pending.textContent = data.response || '(no response)';
        history.push({ role: 'assistant', content: data.response || '' });
      } catch (err) {
        pending.textContent = '⚠️ ' + err.message;
      }
    });
  });
})();
