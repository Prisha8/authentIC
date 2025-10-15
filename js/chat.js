// chat.js — chat UI + collapsible sidebar + Save Chat behavior
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const sidebar = document.getElementById('sidebar');
  const toggleSidebar = document.getElementById('toggleSidebar');
  const newChatBtn = document.getElementById('newChatBtn');
  const chatList = document.getElementById('chatList');
  const messagesEl = document.getElementById('messages');
  const sendBtn = document.getElementById('sendBtn');
  const promptEl = document.getElementById('prompt');
  const imgInput = document.getElementById('imgInput');
  const saveChatBtn = document.getElementById('saveChatBtn');

  // Ensure menu-item titles are set for tooltip in collapsed mode
  document.querySelectorAll('.menu-item').forEach(mi => {
    const txt = mi.querySelector('span') ? mi.querySelector('span').textContent.trim() : mi.getAttribute('data-title') || '';
    if (txt && !mi.getAttribute('data-title')) mi.setAttribute('data-title', txt);
    if (!mi.getAttribute('title')) mi.setAttribute('title', txt);
  });

  // Sidebar toggle
  if (toggleSidebar && sidebar) {
    toggleSidebar.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      // update aria-expanded for accessibility
      const expanded = !sidebar.classList.contains('collapsed');
      toggleSidebar.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }

  // Chat storage
  let chats = [];
  let activeChatId = null;
  let attachedFile = null;

  // Helpers
  function formatTime(date = new Date()){
    return date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  }

  function createChat(title){
    const id = 'c' + Date.now();
    const chat = { id, title: title || `Chat ${chats.length + 1}`, messages: [] };
    chats.unshift(chat);
    renderChatList();
    setActiveChat(chat.id);
  }

  function renderChatList(){
    if(!chatList) return;
    chatList.innerHTML = '';
    chats.forEach(c => {
      const li = document.createElement('li');
      li.className = 'chat-item' + (c.id === activeChatId ? ' active' : '');
      li.dataset.id = c.id;
      li.innerHTML = `<div><h5>${escapeHtml(c.title)}</h5></div><div class="time">${c.messages.length ? formatTime(new Date(c.messages[c.messages.length-1].time)) : ''}</div>`;
      li.addEventListener('click', ()=> setActiveChat(c.id));
      chatList.appendChild(li);
    });
  }

  function setActiveChat(id){
    activeChatId = id;
    document.querySelectorAll('#chatList .chat-item').forEach(it => it.classList.toggle('active', it.dataset.id === id));
    renderMessages();
  }

  function renderMessages(){
    messagesEl.innerHTML = '';
    const chat = chats.find(c => c.id === activeChatId);
    const emptyHtml = `<div class="empty-state"><p>Start a new detection by attaching an image and writing a prompt below.</p></div>`;
    if(!chat || !chat.messages.length){
      messagesEl.innerHTML = emptyHtml;
      return;
    }

    // create container for messages inside
    const container = document.createElement('div');
    container.className = 'chat-card';
    // append messages
    chat.messages.forEach(m => {
      const div = document.createElement('div');
      div.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot');
      if(m.img){
        const im = document.createElement('img');
        im.src = m.img;
        im.style.maxWidth = '360px';
        im.style.display = 'block';
        im.style.marginBottom = '8px';
        div.appendChild(im);
      }
      const p = document.createElement('div');
      p.textContent = m.text;
      div.appendChild(p);
      container.appendChild(div);
    });
    messagesEl.appendChild(container);
    // scroll
    container.scrollTop = container.scrollHeight;
  }

  // new chat
  if (newChatBtn) newChatBtn.addEventListener('click', ()=> createChat('New Detection'));

  // attach image (no preview element)
  if(imgInput){
    imgInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if(!f) { attachedFile = null; return; }
      attachedFile = f;
      // we don't show preview; will attach when sending
    });
  }

  // send/detect
  function handleSend(){
  const text = promptEl.value.trim();
  if(!text && !attachedFile){
    alert('Please write a prompt or attach an image.');
    return;
  }
  // create a chat if none exists
  if(!activeChatId) createChat('New Detection');
  const chat = chats.find(c => c.id === activeChatId);

  // build user message and attach image if present
  const userMsg = { role:'user', text: text || '(image only)', time: Date.now(), img: null };
  if(attachedFile) userMsg.img = URL.createObjectURL(attachedFile);
  chat.messages.push(userMsg);

  // clear input and reset attach
  promptEl.value = '';
  attachedFile = null;
  if(imgInput) imgInput.value = '';

  renderMessages();
  renderChatList();

  // disable controls while "processing"
  if(sendBtn) sendBtn.disabled = true;
  if(promptEl) promptEl.disabled = true;

  // small initial delay before showing the "thinking" message
  const preDelay = 300 + Math.random()*300; // 300-600ms
  setTimeout(() => {
    // push a thinking message that we'll update with dots
    const thinkingMsg = { role:'bot', text: 'Analyzing image and metadata', time: Date.now(), _thinking: true };
    chat.messages.push(thinkingMsg);
    renderMessages();

    // animate trailing dots by updating the last message text periodically
    let dotCount = 0;
    const dotInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4; // 0..3
      const dots = '.'.repeat(dotCount);
      thinkingMsg.text = 'Analyzing image and metadata' + (dots ? ' ' + dots : '');
      renderMessages();
    }, 450); // update every 450ms

    // make the main processing time a little longer so the user perceives work is happening
    const processingTime = 1200 + Math.random()*1400; // 1.2s - 2.6s

    setTimeout(() => {
      // stop the dots
      clearInterval(dotInterval);

      // remove the thinking message
      // (we find the last thinking message and replace it with the result)
      const idx = chat.messages.findIndex(m => m._thinking);
      if(idx !== -1) chat.messages.splice(idx, 1);

      // generate a fake result
      const confidence = Math.round(70 + Math.random()*28); // 70 - 98
      const result = `Confidence: ${confidence}% genuine.\nAdvice: ${confidence < 85 ? 'Low confidence — consider lab testing.' : 'High confidence — cross-check package and markings.'}`;
      chat.messages.push({ role:'bot', text: result, time: Date.now() });

      // re-enable controls
      if(sendBtn) sendBtn.disabled = false;
      if(promptEl) promptEl.disabled = false;

      renderMessages();
      renderChatList();

    }, processingTime);

  }, preDelay);
}




  if(sendBtn) sendBtn.addEventListener('click', handleSend);
  if(promptEl) promptEl.addEventListener('keydown', (e)=> {
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); handleSend(); }
  });

  // save chat title
  if(saveChatBtn) saveChatBtn.addEventListener('click', () => {
    if(!activeChatId){ alert('Start a chat first.'); return; }
    const chat = chats.find(c => c.id === activeChatId);
    const newTitle = prompt('Enter a title for this chat:', chat.title || 'IC Check');
    if(newTitle && newTitle.trim()){
      chat.title = newTitle.trim();
      renderChatList();
    }
  });

  // basic esc to close collapsed sidebar on mobile: clicking outside closes (optional)
  document.addEventListener('click', (e) => {
    if(window.innerWidth < 900 && sidebar && !sidebar.contains(e.target) && !sidebar.classList.contains('collapsed')) {
      sidebar.classList.add('collapsed');
    }
  });

  // helper to escape html
  function escapeHtml(str){
    return String(str).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
  }

  // create default demo chat
  createChat('IC Check 1');
});
