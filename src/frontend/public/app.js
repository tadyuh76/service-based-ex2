const API_BASE = "http://localhost:8000";

const state = {
  users: [],
  books: [],
  borrows: [],
  notifications: []
};

const elements = {
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  readerSelect: document.getElementById("reader-select"),
  refreshButton: document.getElementById("refresh-button"),
  bookCount: document.getElementById("book-count"),
  activeCount: document.getElementById("active-count"),
  books: document.getElementById("books"),
  borrows: document.getElementById("borrows"),
  notifications: document.getElementById("notifications"),
  toast: document.getElementById("toast")
};

elements.refreshButton.addEventListener("click", loadDashboard);

loadDashboard();

async function loadDashboard() {
  setBusy(true);
  try {
    const [users, books, borrows, notifications] = await Promise.all([
      api("/api/users"),
      api("/api/books"),
      api("/api/borrow?active=true"),
      api("/api/notifications")
    ]);

    state.users = users;
    state.books = books;
    state.borrows = borrows;
    state.notifications = notifications;

    renderUsers();
    renderBooks();
    renderBorrows();
    renderNotifications();
    setOnline(true);
  } catch (error) {
    setOnline(false);
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

function renderUsers() {
  const current = elements.readerSelect.value;
  elements.readerSelect.innerHTML = state.users
    .map((user) => {
      const label = `${user.fullName} (${user.rank})`;
      return `<option value="${user.id}">${escapeHtml(label)}</option>`;
    })
    .join("");

  if (current) {
    elements.readerSelect.value = current;
  }
}

function renderBooks() {
  elements.bookCount.textContent = `${state.books.length} item${state.books.length === 1 ? "" : "s"}`;

  if (state.books.length === 0) {
    elements.books.innerHTML = `<p class="empty-state">No books found.</p>`;
    return;
  }

  elements.books.innerHTML = state.books
    .map((book) => {
      const empty = book.stock <= 0;
      return `
        <article class="book-item">
          <div class="book-strip"></div>
          <div class="book-body">
            <h3 class="book-title">${escapeHtml(book.title)}</h3>
            <p class="book-author">${escapeHtml(book.author)}</p>
            <span class="stock ${empty ? "empty" : ""}">${book.stock} available</span>
          </div>
          <div class="book-actions">
            <button type="button" data-book-id="${book.id}" ${empty ? "disabled" : ""}>
              Borrow
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  for (const button of elements.books.querySelectorAll("button[data-book-id]")) {
    button.addEventListener("click", () => borrowBook(Number(button.dataset.bookId)));
  }
}

function renderBorrows() {
  elements.activeCount.textContent = `${state.borrows.length} active`;

  if (state.borrows.length === 0) {
    elements.borrows.innerHTML = `<p class="empty-state">No active borrows.</p>`;
    return;
  }

  const bookById = new Map(state.books.map((book) => [book.id, book]));
  elements.borrows.innerHTML = state.borrows
    .map((record) => {
      const book = bookById.get(record.bookId);
      return `
        <article class="activity-item">
          <p><strong>${escapeHtml(book ? book.title : `Book #${record.bookId}`)}</strong></p>
          <small>User #${record.userId} · ${formatDate(record.borrowDate)}</small>
        </article>
      `;
    })
    .join("");
}

function renderNotifications() {
  const latest = state.notifications.slice(0, 5);

  if (latest.length === 0) {
    elements.notifications.innerHTML = `<p class="empty-state">No notifications yet.</p>`;
    return;
  }

  elements.notifications.innerHTML = latest
    .map(
      (log) => `
        <article class="activity-item">
          <p>${escapeHtml(log.message)}</p>
          <small>${formatDate(log.sentDate)}</small>
        </article>
      `
    )
    .join("");
}

async function borrowBook(bookId) {
  const userId = Number(elements.readerSelect.value);

  if (!userId) {
    showToast("Select a reader before borrowing.", true);
    return;
  }

  setBusy(true);
  try {
    const result = await api("/api/borrow", {
      method: "POST",
      body: { userId, bookId }
    });

    showToast(result.message || "Borrowing completed.");
    await loadDashboard();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function api(path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: { Accept: "application/json" }
  };

  if (options.body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE}${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }

  return payload;
}

function setBusy(isBusy) {
  elements.refreshButton.disabled = isBusy;
  for (const button of document.querySelectorAll("button[data-book-id]")) {
    if (isBusy) {
      button.dataset.wasDisabled = String(button.disabled);
      button.disabled = true;
    } else {
      button.disabled = button.dataset.wasDisabled === "true";
      delete button.dataset.wasDisabled;
    }
  }
}

function setOnline(isOnline) {
  elements.statusDot.classList.toggle("online", isOnline);
  elements.statusText.textContent = isOnline ? "Gateway online" : "Gateway offline";
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 3000);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
