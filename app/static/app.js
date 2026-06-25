const state = {
  files: [],
  categories: [],
  view: "files",
  selectedFileId: null,
  selectedSheetId: null,
  sheetOffset: 0,
  sheetLimit: 100,
  mergedOffset: 0,
  mergedLimit: 100,
  search: "",
  fileCategoryFilter: "",
  fileStatusFilter: "",
  fileSort: "newest",
  filesLayout: localStorage.getItem("filesLayout") || "cards",
  tableMode: localStorage.getItem("tableMode") || "clean",
  theme: localStorage.getItem("theme") || "light",
  viewerFileSearch: "",
  mergedCategoryFilter: "",
  selectedMergeFileIds: new Set(),
  expandedCategoryIds: new Set(JSON.parse(localStorage.getItem("expandedCategoryIds") || "[]")),
  viewHistory: [],
  currentSheetData: null,
  currentMergedData: null,
  isAdmin: false,
  adminAuth: sessionStorage.getItem("adminAuth") || "",
  polling: null,
};

const FILE_RENDER_LIMIT = 300;
const EXCEL_HEADER_ROW_HEIGHT = 24;
const EXCEL_TITLE_ROW_HEIGHT = 58;

const el = {
  fileInput: document.getElementById("fileInput"),
  uploadZone: document.getElementById("uploadZone"),
  uploadCategorySelect: document.getElementById("uploadCategorySelect"),
  categoryTree: document.getElementById("categoryTree"),
  clearTreeFilter: document.getElementById("clearTreeFilter"),
  refreshBtn: document.getElementById("refreshBtn"),
  navItems: [...document.querySelectorAll(".nav-item")],
  filesView: document.getElementById("filesView"),
  categoriesView: document.getElementById("categoriesView"),
  viewerView: document.getElementById("viewerView"),
  mergedView: document.getElementById("mergedView"),
  filesGrid: document.getElementById("filesGrid"),
  categoryGrid: document.getElementById("categoryGrid"),
  addCategoryForm: document.getElementById("addCategoryForm"),
  newCategoryParent: document.getElementById("newCategoryParent"),
  newCategoryName: document.getElementById("newCategoryName"),
  viewTitle: document.getElementById("viewTitle"),
  globalSearch: document.getElementById("globalSearch"),
  backBtn: document.getElementById("backBtn"),
  themeToggle: document.getElementById("themeToggle"),
  adminStatus: document.getElementById("adminStatus"),
  adminLoginBtn: document.getElementById("adminLoginBtn"),
  adminLogoutBtn: document.getElementById("adminLogoutBtn"),
  adminModal: document.getElementById("adminModal"),
  adminLoginForm: document.getElementById("adminLoginForm"),
  adminUsername: document.getElementById("adminUsername"),
  adminPassword: document.getElementById("adminPassword"),
  adminModalCancel: document.getElementById("adminModalCancel"),
  totalFiles: document.getElementById("totalFiles"),
  totalCategories: document.getElementById("totalCategories"),
  totalRows: document.getElementById("totalRows"),
  systemStatus: document.getElementById("systemStatus"),
  fileCategoryFilter: document.getElementById("fileCategoryFilter"),
  fileStatusFilter: document.getElementById("fileStatusFilter"),
  fileSort: document.getElementById("fileSort"),
  fileResultCount: document.getElementById("fileResultCount"),
  fileLayoutButtons: [...document.querySelectorAll("[data-files-layout]")],
  deleteAllFilesBtn: document.getElementById("deleteAllFilesBtn"),
  viewerFileSearch: document.getElementById("viewerFileSearch"),
  fileSelect: document.getElementById("fileSelect"),
  sheetSelect: document.getElementById("sheetSelect"),
  sheetTitle: document.getElementById("sheetTitle"),
  tableWrap: document.getElementById("tableWrap"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageInfo: document.getElementById("pageInfo"),
  pageSize: document.getElementById("pageSize"),
  tableModeButtons: [...document.querySelectorAll("[data-table-mode]")],
  sheetSearchCount: document.getElementById("sheetSearchCount"),
  copySheetBtn: document.getElementById("copySheetBtn"),
  exportSheetBtn: document.getElementById("exportSheetBtn"),
  fullscreenSheetBtn: document.getElementById("fullscreenSheetBtn"),
  mergedCategoryFilter: document.getElementById("mergedCategoryFilter"),
  selectVisibleFiles: document.getElementById("selectVisibleFiles"),
  clearSelectedFiles: document.getElementById("clearSelectedFiles"),
  mergeFileList: document.getElementById("mergeFileList"),
  mergedTitle: document.getElementById("mergedTitle"),
  mergedTableWrap: document.getElementById("mergedTableWrap"),
  mergedPrevPage: document.getElementById("mergedPrevPage"),
  mergedNextPage: document.getElementById("mergedNextPage"),
  mergedPageInfo: document.getElementById("mergedPageInfo"),
  mergedPageSize: document.getElementById("mergedPageSize"),
  mergedSearchCount: document.getElementById("mergedSearchCount"),
  copyMergedBtn: document.getElementById("copyMergedBtn"),
  exportMergedBtn: document.getElementById("exportMergedBtn"),
  fullscreenMergedBtn: document.getElementById("fullscreenMergedBtn"),
  toast: document.getElementById("toast"),
};

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("az-AZ").format(value || 0);
}

function statusLabel(status) {
  return {
    queued: "Növbədə",
    importing: "Import edilir",
    ready: "Hazır",
    failed: "Xəta",
  }[status] || status;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => el.toast.classList.remove("show"), 3500);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.adminAuth && !headers.has("Authorization")) {
    headers.set("Authorization", state.adminAuth);
  }
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = "Sorğu tamamlanmadı";
    try {
      const data = await response.json();
      message = data.detail || message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }
  return response.json();
}

async function adminApi(path, options = {}) {
  if (!state.isAdmin) {
    throw new Error("Bu əməliyyat üçün admin girişi lazımdır.");
  }
  return api(path, options);
}

async function checkSession() {
  try {
    const data = await api("/api/session");
    state.isAdmin = Boolean(data.is_admin);
    if (!state.isAdmin && state.adminAuth) {
      state.adminAuth = "";
      sessionStorage.removeItem("adminAuth");
    }
  } catch {
    state.isAdmin = false;
    state.adminAuth = "";
    sessionStorage.removeItem("adminAuth");
  }
  applyAdminState();
}

function applyAdminState() {
  document.body.classList.toggle("admin", state.isAdmin);
  el.adminStatus.textContent = state.isAdmin ? "Admin" : "Adi baxış";
  el.adminLoginBtn.classList.toggle("hidden", state.isAdmin);
  el.adminLogoutBtn.classList.toggle("hidden", !state.isAdmin);
}

async function loadData({ keepSelection = true } = {}) {
  const [filesData, categoriesData] = await Promise.all([api("/api/files"), api("/api/categories")]);
  state.files = filesData.files || [];
  state.categories = categoriesData.categories || [];

  if (!keepSelection || !state.files.some((file) => file.id === state.selectedFileId)) {
    state.selectedFileId = firstReadyFile()?.id || state.files[0]?.id || null;
    state.selectedSheetId = selectedFile()?.sheets?.[0]?.id || null;
    state.sheetOffset = 0;
  }

  if (!selectedSheet() && selectedFile()?.sheets?.[0]) {
    state.selectedSheetId = selectedFile().sheets[0].id;
  }

  renderSummary();
  renderCategoryOptions();
  renderCategoryTree();
  renderUiPreferences();
  renderFileControls();
  renderActiveView();
  setupPolling();
}

function renderUiPreferences() {
  document.body.dataset.theme = state.theme;
  el.themeToggle.textContent = state.theme === "dim" ? "Light" : "Dim";
  el.fileLayoutButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.filesLayout === state.filesLayout);
  });
  el.tableModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tableMode === state.tableMode);
  });
}

function renderSummary() {
  const totalRows = state.files.reduce(
    (sum, file) => sum + file.sheets.reduce((sheetSum, sheet) => sheetSum + sheet.row_count, 0),
    0,
  );
  const hasImporting = state.files.some((file) => file.status === "queued" || file.status === "importing");
  el.totalFiles.textContent = formatNumber(state.files.length);
  el.totalCategories.textContent = formatNumber(state.categories.length);
  el.totalRows.textContent = formatNumber(totalRows);
  el.systemStatus.textContent = hasImporting ? "Import gedir" : "Hazır";
}

function renderCategoryOptions() {
  const selectedParent = el.newCategoryParent.value;
  const categoryOptions = state.categories.map(
    (category) => `<option value="${category.id}">${escapeHtml(categoryOptionLabel(category))}</option>`,
  );
  const basicOptions = [`<option value="">Bölməsiz</option>`]
    .concat(categoryOptions)
    .join("");
  el.uploadCategorySelect.innerHTML = basicOptions;
  el.newCategoryParent.innerHTML = [`<option value="">Kök bölmə</option>`, ...categoryOptions].join("");
  if ([...el.newCategoryParent.options].some((option) => option.value === selectedParent)) {
    el.newCategoryParent.value = selectedParent;
  }

  el.fileCategoryFilter.innerHTML = [
    `<option value="">Bütün bölmələr</option>`,
    `<option value="none">Bölməsiz</option>`,
    ...categoryOptions,
  ].join("");
  el.fileCategoryFilter.value = state.fileCategoryFilter;

  el.mergedCategoryFilter.innerHTML = [
    `<option value="">Bütün bölmələr</option>`,
    ...categoryOptions,
  ].join("");
  el.mergedCategoryFilter.value = state.mergedCategoryFilter;
}

function renderCategoryTree() {
  if (!el.categoryTree) return;
  if (!state.categories.length) {
    el.categoryTree.innerHTML = `<div class="tree-empty">Bölmə yoxdur</div>`;
    return;
  }

  el.categoryTree.innerHTML = state.categories
    .filter((category) => isCategoryVisibleInTree(category))
    .map((category) => {
      const fileCount = filesByCategory(category.id).length;
      const isActive = state.fileCategoryFilter && String(category.id) === String(state.fileCategoryFilter);
      const hasChildren = categoryHasChildren(category.id);
      const isExpanded = state.expandedCategoryIds.has(Number(category.id));
      const arrow = hasChildren ? (isExpanded ? "▾" : "▸") : "";
      return `
        <button class="tree-node ${isActive ? "active" : ""} ${hasChildren ? "has-children" : ""}" data-tree-category="${category.id}" data-has-children="${hasChildren ? "1" : "0"}" style="--tree-level:${category.level || 0}" type="button">
          <span class="tree-icon"><span class="tree-arrow">${arrow}</span><span class="tree-folder ${hasChildren && isExpanded ? "open" : ""}" aria-hidden="true"></span></span>
          <span class="tree-name">${escapeHtml(category.name)}</span>
          <span class="tree-count">${formatNumber(fileCount)}</span>
        </button>
      `;
    })
    .join("");
}

function renderFileControls() {
  el.fileSelect.innerHTML = "";
  const query = state.viewerFileSearch.toLowerCase();
  const readyFiles = sortFiles(
    state.files.filter((file) => {
      if (file.status !== "ready") return false;
      if (!query) return true;
      return fileSearchText(file).includes(query);
    }),
  );

  if (!readyFiles.length) {
    state.selectedFileId = null;
    state.selectedSheetId = null;
    el.fileSelect.innerHTML = `<option value="">Hazır fayl yoxdur</option>`;
    el.sheetSelect.innerHTML = `<option value="">Sheet yoxdur</option>`;
    return;
  }

  for (const file of readyFiles) {
    const option = document.createElement("option");
    option.value = file.id;
    option.textContent = file.original_name;
    option.selected = file.id === state.selectedFileId;
    el.fileSelect.appendChild(option);
  }

  if (!readyFiles.some((file) => file.id === state.selectedFileId)) {
    state.selectedFileId = readyFiles[0].id;
    state.selectedSheetId = readyFiles[0].sheets[0]?.id || null;
  }

  renderSheetSelect();
}

function renderSheetSelect() {
  const file = selectedFile();
  el.sheetSelect.innerHTML = "";

  if (!file?.sheets?.length) {
    el.sheetSelect.innerHTML = `<option value="">Sheet yoxdur</option>`;
    return;
  }

  for (const sheet of file.sheets) {
    const option = document.createElement("option");
    option.value = sheet.id;
    option.textContent = `${sheet.name} (${formatNumber(sheet.row_count)}x${formatNumber(sheet.column_count)})`;
    option.selected = sheet.id === state.selectedSheetId;
    el.sheetSelect.appendChild(option);
  }
}

function currentViewSnapshot() {
  return {
    view: state.view,
    search: state.search,
    fileCategoryFilter: state.fileCategoryFilter,
    fileStatusFilter: state.fileStatusFilter,
    fileSort: state.fileSort,
    selectedFileId: state.selectedFileId,
    selectedSheetId: state.selectedSheetId,
    sheetOffset: state.sheetOffset,
    mergedOffset: state.mergedOffset,
    mergedCategoryFilter: state.mergedCategoryFilter,
    selectedMergeFileIds: [...state.selectedMergeFileIds],
  };
}

function snapshotsMatch(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pushViewHistory() {
  const snapshot = currentViewSnapshot();
  const last = state.viewHistory[state.viewHistory.length - 1];
  if (last && snapshotsMatch(last, snapshot)) return;
  state.viewHistory.push(snapshot);
  if (state.viewHistory.length > 25) {
    state.viewHistory.shift();
  }
}

function restoreViewSnapshot(snapshot) {
  if (!snapshot) return;
  state.view = snapshot.view === "merged" && !state.isAdmin ? "files" : snapshot.view;
  state.search = snapshot.search || "";
  state.fileCategoryFilter = snapshot.fileCategoryFilter || "";
  state.fileStatusFilter = snapshot.fileStatusFilter || "";
  state.fileSort = snapshot.fileSort || "newest";
  state.selectedFileId = snapshot.selectedFileId || null;
  state.selectedSheetId = snapshot.selectedSheetId || null;
  state.sheetOffset = snapshot.sheetOffset || 0;
  state.mergedOffset = snapshot.mergedOffset || 0;
  state.mergedCategoryFilter = snapshot.mergedCategoryFilter || "";
  state.selectedMergeFileIds = new Set(snapshot.selectedMergeFileIds || []);

  el.globalSearch.value = state.search;
  el.fileCategoryFilter.value = state.fileCategoryFilter;
  el.fileStatusFilter.value = state.fileStatusFilter;
  el.fileSort.value = state.fileSort;
  renderCategoryTree();
  renderFileControls();
  renderActiveView();
}

function goBack() {
  const previous = state.viewHistory.pop();
  restoreViewSnapshot(previous);
}

function renderBackButton() {
  if (!el.backBtn) return;
  el.backBtn.classList.toggle("hidden", state.viewHistory.length === 0);
}

function switchView(view, { recordHistory = true, resetSearch = true } = {}) {
  if (view === "merged" && !state.isAdmin) {
    view = "files";
  }
  if (recordHistory) {
    pushViewHistory();
  }
  state.view = view;
  if (resetSearch) {
    state.search = "";
    el.globalSearch.value = "";
  }
  state.sheetOffset = 0;
  state.mergedOffset = 0;
  renderActiveView();
}

function renderActiveView() {
  if (state.view === "merged" && !state.isAdmin) {
    state.view = "files";
  }
  el.navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === state.view));
  el.filesView.classList.toggle("active", state.view === "files");
  el.categoriesView.classList.toggle("active", state.view === "categories");
  el.viewerView.classList.toggle("active", state.view === "viewer");
  el.mergedView.classList.toggle("active", state.view === "merged");
  renderBackButton();

  if (state.view === "files") {
    el.viewTitle.textContent = "Fayllar";
    el.globalSearch.placeholder = "Fayl adı, bölmə, status və ya sheet axtar...";
    renderFilesPage();
  } else if (state.view === "categories") {
    el.viewTitle.textContent = "Bölmələr";
    el.globalSearch.placeholder = "Bölmə və ya fayl axtar...";
    renderCategoriesPage();
  } else if (state.view === "viewer") {
    el.viewTitle.textContent = "Cədvəllər";
    el.globalSearch.placeholder = "Seçilmiş sheet daxilində axtar...";
    loadSheetRows();
  } else {
    el.viewTitle.textContent = "Birləşmiş data";
    el.globalSearch.placeholder = "Seçilmiş merge daxilində axtar...";
    renderMergeFileList();
    loadMergedRows();
  }
}

function renderFilesPage() {
  const query = state.search.toLowerCase();
  const files = sortFiles(state.files.filter((file) => {
    if (state.fileCategoryFilter === "none" && file.category_id) return false;
    if (
      state.fileCategoryFilter &&
      state.fileCategoryFilter !== "none" &&
      !categoryDescendantIds(Number(state.fileCategoryFilter)).has(file.category_id)
    ) {
      return false;
    }
    if (state.fileStatusFilter && file.status !== state.fileStatusFilter) return false;

    const haystack = [
      file.original_name,
      file.category_name || "Bölməsiz",
      statusLabel(file.status),
      file.message,
      file.sha256,
      ...file.sheets.map((sheet) => sheet.name),
      ...file.sheets.map((sheet) => sheet.heading_text || ""),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  }));

  el.filesGrid.innerHTML = "";
  const visibleFiles = files.slice(0, FILE_RENDER_LIMIT);
  el.fileResultCount.textContent =
    files.length > FILE_RENDER_LIMIT
      ? `${formatNumber(files.length)} fayl · ilk ${formatNumber(FILE_RENDER_LIMIT)}`
      : `${formatNumber(files.length)} fayl`;

  if (!files.length) {
    el.filesGrid.innerHTML = emptyMarkup("Fayl tapılmadı.", "Yeni Excel faylı yükləyin və ya filteri dəyişin.");
    return;
  }

  el.filesGrid.classList.toggle("list-mode", state.filesLayout === "list");
  if (state.filesLayout === "list") {
    renderFilesList(visibleFiles);
    return;
  }

  for (const file of visibleFiles) {
    const rowCount = file.sheets.reduce((sum, sheet) => sum + sheet.row_count, 0);
    const sheetNames = file.sheets.slice(0, 5).map((sheet) => sheet.name).join(", ");
    const snippet = query ? matchedHeadingSnippet(file, query) : "";
    const card = document.createElement("article");
    card.className = "file-card";
    card.innerHTML = `
      <div class="file-name">${escapeHtml(file.original_name)}</div>
      <label class="field-label admin-only">
        Fayl adı
        <div class="inline-edit">
          <input data-file-name-input="${file.id}" type="text" maxlength="180" value="${escapeHtml(file.original_name)}" />
          <button class="button secondary" data-action="rename" data-id="${file.id}" type="button">Saxla</button>
        </div>
      </label>
      <div class="file-meta-row">
        <span class="file-meta admin-only file-admin-detail">${formatBytes(file.size_bytes)}</span>
        <span class="status ${file.status}">${statusLabel(file.status)}</span>
      </div>
      <label class="field-label admin-only">
        Bölmə
        <select data-file-category="${file.id}">
          <option value="">Bölməsiz</option>
          ${state.categories.map((category) => `<option value="${category.id}" ${category.id === file.category_id ? "selected" : ""}>${escapeHtml(categoryOptionLabel(category))}</option>`).join("")}
        </select>
      </label>
      <div class="file-detail-grid">
        <div>Bölmə: <span>${escapeHtml(file.category_name || "Bölməsiz")}</span></div>
        <div>Sheet: <span>${formatNumber(file.sheets.length)}</span></div>
        <div>Sətir: <span>${formatNumber(rowCount)}</span></div>
        <div class="admin-only file-admin-detail">Yüklənmə: <span>${escapeHtml(file.uploaded_at || "")}</span></div>
        <div class="admin-only file-admin-detail">Import: <span>${escapeHtml(file.imported_at || "-")}</span></div>
        <div class="admin-only file-admin-detail">SHA256: <span>${escapeHtml((file.sha256 || "").slice(0, 16))}...</span></div>
        <div class="admin-only file-admin-detail">Sheet adları: <span>${escapeHtml(sheetNames || "-")}</span></div>
      </div>
      ${snippet ? `<small class="match-snippet strong">Tapıldı: ${highlightMatch(snippet, query)}</small>` : ""}
      <div class="progress admin-only file-admin-detail"><span style="width:${file.progress}%"></span></div>
      <div class="file-meta admin-only file-admin-detail">${escapeHtml(file.message || "")}</div>
      <div class="file-actions">
        <button class="button secondary" data-action="view" data-id="${file.id}" type="button" ${file.status === "ready" ? "" : "disabled"}>Bax</button>
        <button class="button secondary admin-only" data-action="merge-one" data-id="${file.id}" type="button" ${file.status === "ready" ? "" : "disabled"}>Merge</button>
        <button class="button secondary admin-only" data-action="reimport" data-id="${file.id}" type="button">Yenidən import</button>
        <a class="button ghost" href="/api/files/${file.id}/download">Endir</a>
        <button class="button danger admin-only" data-action="delete" data-id="${file.id}" type="button">Sil</button>
      </div>
    `;
    el.filesGrid.appendChild(card);
  }
}

function renderFilesList(files) {
  const rows = files
    .map((file) => {
      const rowCount = file.sheets.reduce((sum, sheet) => sum + sheet.row_count, 0);
      const snippet = state.search ? matchedHeadingSnippet(file, state.search.toLowerCase()) : "";
      return `
        <tr>
          <td class="file-list-name">
            <strong>${escapeHtml(file.original_name)}</strong>
            <div class="inline-edit admin-only">
              <input data-file-name-input="${file.id}" type="text" maxlength="180" value="${escapeHtml(file.original_name)}" aria-label="Fayl adı" />
              <button class="button secondary" data-action="rename" data-id="${file.id}" type="button">Saxla</button>
            </div>
            ${snippet ? `<small class="match-snippet">Tapildi: ${highlightMatch(snippet, state.search)}</small>` : ""}
          </td>
          <td>${escapeHtml(file.category_name || "Bolmesiz")}</td>
          <td>${formatNumber(file.sheets.length)}</td>
          <td>${formatNumber(rowCount)}</td>
          <td><span class="status ${file.status}">${statusLabel(file.status)}</span></td>
          <td class="file-list-actions">
            <button class="button secondary" data-action="view" data-id="${file.id}" type="button" ${file.status === "ready" ? "" : "disabled"}>Bax</button>
            <button class="button secondary admin-only" data-action="merge-one" data-id="${file.id}" type="button" ${file.status === "ready" ? "" : "disabled"}>Merge</button>
          </td>
        </tr>
      `;
    })
    .join("");

  el.filesGrid.innerHTML = `
    <div class="files-table-wrap">
      <table class="files-table">
        <thead>
          <tr>
            <th>Fayl</th>
            <th>Bolme</th>
            <th>Sheet</th>
            <th>Setir</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function sortFiles(files) {
  const copy = [...files];
  const rowCount = (file) => file.sheets.reduce((sum, sheet) => sum + sheet.row_count, 0);
  const byName = (a, b) => a.original_name.localeCompare(b.original_name, "az");

  if (state.fileSort === "name") {
    copy.sort(byName);
  } else if (state.fileSort === "category") {
    copy.sort((a, b) => (a.category_name || "Bölməsiz").localeCompare(b.category_name || "Bölməsiz", "az") || byName(a, b));
  } else if (state.fileSort === "rows") {
    copy.sort((a, b) => rowCount(b) - rowCount(a) || byName(a, b));
  } else if (state.fileSort === "sheets") {
    copy.sort((a, b) => b.sheets.length - a.sheets.length || byName(a, b));
  } else {
    copy.sort((a, b) => String(b.uploaded_at || "").localeCompare(String(a.uploaded_at || "")) || byName(a, b));
  }

  return copy;
}

function renderCategoriesPage() {
  renderCategoryOptions();
  const query = state.search.toLowerCase();
  const categories = state.categories.filter((category) => {
    const files = filesByCategory(category.id);
    if (!query) return true;
    if (String(category.name || "").toLowerCase().includes(query)) return true;
    return files.some((file) => fileSearchText(file).includes(query));
  });

  el.categoryGrid.innerHTML = "";
  if (!categories.length) {
    el.categoryGrid.innerHTML = emptyMarkup("Bölmə tapılmadı.", "Yeni bölmə əlavə edin və ya axtarışı dəyişin.");
    return;
  }

  for (const category of categories) {
    const files = filesByCategory(category.id);
    const sheetCount = files.reduce((sum, file) => sum + file.sheets.length, 0);
    const rowCount = files.reduce((sum, file) => sum + file.sheets.reduce((sheetSum, sheet) => sheetSum + sheet.row_count, 0), 0);
    const childCategories = state.categories.filter((item) => item.parent_id === category.id);
    const childPreview = childCategories
      .slice(0, 5)
      .map((item) => `<span class="folder-chip">${escapeHtml(item.name)}</span>`)
      .join("");
    const card = document.createElement("article");
    card.className = "category-card";
    card.style.setProperty("--category-level", category.level || 0);
    card.innerHTML = `
      <div class="category-title-block">
        <h4>${escapeHtml(category.name)}</h4>
        ${category.path && category.path !== category.name ? `<small>${escapeHtml(category.path)}</small>` : `<small>Kök bölmə</small>`}
      </div>
      <div class="category-stats">
        <div><strong>${formatNumber(files.length)}</strong><span>fayl</span></div>
        <div><strong>${formatNumber(sheetCount)}</strong><span>sheet</span></div>
        <div><strong>${formatNumber(rowCount)}</strong><span>sətir</span></div>
      </div>
      ${childPreview ? `<div class="folder-chip-row">${childPreview}</div>` : ""}
      <div class="file-actions category-actions">
        <button class="button category-open-button" data-action="open-category" data-id="${category.id}" type="button">Fayllar</button>
        <button class="button secondary admin-only" data-action="merge-category" data-id="${category.id}" type="button">Merge et</button>
        <button class="button secondary admin-only" data-action="sub-category" data-id="${category.id}" type="button">Alt bölmə</button>
        <button class="button danger admin-only" data-action="delete-category" data-id="${category.id}" type="button">Sil</button>
      </div>
    `;
    el.categoryGrid.appendChild(card);
  }
}

async function loadSheetRows() {
  const file = selectedFile();
  const sheet = selectedSheet();

  if (!file || file.status !== "ready") {
    el.sheetTitle.textContent = "Hazır fayl seçin";
    el.tableWrap.innerHTML = emptyMarkup("Göstəriləcək hazır fayl yoxdur.", "Excel faylı yükləyin və importun tamamlanmasını gözləyin.");
    el.pageInfo.textContent = "0-0";
    el.sheetSearchCount.textContent = "0 netice";
    state.currentSheetData = null;
    setSheetPager(false, false);
    return;
  }

  if (!sheet) {
    el.sheetTitle.textContent = "Sheet seçin";
    el.tableWrap.innerHTML = emptyMarkup("Bu faylda sheet yoxdur.", "");
    el.pageInfo.textContent = "0-0";
    el.sheetSearchCount.textContent = "0 netice";
    state.currentSheetData = null;
    setSheetPager(false, false);
    return;
  }

  el.sheetTitle.textContent = `${file.original_name} / ${sheet.name}`;
  el.tableWrap.innerHTML = emptyMarkup("Yüklənir...", "");

  try {
    const params = new URLSearchParams({
      offset: state.sheetOffset,
      limit: state.sheetLimit,
      q: state.search,
    });
    const data = await api(`/api/sheets/${sheet.id}/rows?${params.toString()}`);
    renderSheetTable(data);
  } catch (error) {
    el.tableWrap.innerHTML = emptyMarkup("Sheet datası yüklənmədi.", error.message);
  }
}

function renderSheetTable(data) {
  const rows = data.rows || [];
  if (!rows.length) {
    el.tableWrap.innerHTML = emptyMarkup("Data tapılmadı.", "Axtarışı dəyişin və ya başqa sheet seçin.");
    el.pageInfo.textContent = "0-0";
    el.sheetSearchCount.textContent = "0 netice";
    state.currentSheetData = data;
    setSheetPager(state.sheetOffset > 0, false);
    return;
  }

  const rawView = { rows, columns: data.columns || [], meta: data.meta || {} };
  const view = state.tableMode === "clean" ? prepareSheetView(rawView.rows, rawView.columns, rawView.meta) : rawView;
  state.currentSheetData = { ...data, view };
  el.sheetSearchCount.textContent = state.search
    ? `${formatNumber(data.total)} netice`
    : `${formatNumber(data.total)} setir`;
  const body = renderExcelLikeRows(view.rows, view.columns, view.meta, state.search);

  el.tableWrap.innerHTML = `
    <table class="excel-table">
      <tbody>${body}</tbody>
    </table>
  `;

  const start = data.offset + 1;
  const end = data.offset + rows.length;
  el.pageInfo.textContent = `${formatNumber(start)}-${formatNumber(end)} / ${formatNumber(data.total)}`;
  setSheetPager(state.sheetOffset > 0, end < data.total);
}

function prepareSheetView(rows, columns, meta = {}) {
  const columnWindow = visibleColumnWindow(rows, meta);
  if (!columnWindow || (columnWindow.start === 0 && columnWindow.end === columns.length - 1)) {
    return { rows, columns, meta };
  }

  const start = columnWindow.start;
  const end = columnWindow.end;
  const visibleRows = rows.map((row) => ({
    ...row,
    cells: row.cells.slice(start, end + 1),
    styles: shiftRowStyles(row.styles, start, end),
  }));
  const visibleMeta = {
    ...meta,
    merged_cells: (meta.merged_cells || [])
      .map((mergedCell) => shiftMergedCell(mergedCell, start, end))
      .filter(Boolean),
  };

  return {
    rows: visibleRows,
    columns: columns.slice(start, end + 1),
    meta: visibleMeta,
  };
}

function shiftRowStyles(styles = {}, startIndex, endIndex) {
  const bold = (styles.bold || [])
    .filter((index) => index >= startIndex && index <= endIndex)
    .map((index) => index - startIndex);
  return bold.length ? { bold } : {};
}

function isBoldCell(row, index) {
  return Array.isArray(row?.styles?.bold) && row.styles.bold.includes(index);
}

function rowHasBold(row) {
  return Array.isArray(row?.styles?.bold) && row.styles.bold.length > 0;
}

function visibleColumnWindow(rows, meta = {}) {
  let start = Number.POSITIVE_INFINITY;
  let end = -1;

  for (const row of rows) {
    for (let index = 0; index < row.cells.length; index += 1) {
      if (String(row.cells[index] ?? "").trim() === "") continue;
      start = Math.min(start, index);
      end = Math.max(end, index);
    }
  }

  for (const mergedCell of meta.merged_cells || []) {
    const c1 = Number(mergedCell.c1) - 1;
    const c2 = Number(mergedCell.c2) - 1;
    if (!Number.isFinite(c1) || !Number.isFinite(c2)) continue;
    const hasVisibleText = rows.some((row) => {
      const rowNumber = Number(row.row_number);
      const r1 = Number(mergedCell.r1);
      const r2 = Number(mergedCell.r2);
      if (Number.isFinite(r1) && Number.isFinite(r2) && (rowNumber < r1 || rowNumber > r2)) return false;
      return row.cells.slice(Math.max(0, c1), c2 + 1).some((cell) => String(cell ?? "").trim() !== "");
    });
    if (!hasVisibleText) continue;
    start = Math.min(start, c1);
    end = Math.max(end, c2);
  }

  if (!Number.isFinite(start) || end < start) return null;
  return { start, end };
}

function shiftMergedCell(mergedCell, startIndex, endIndex) {
  const c1 = Number(mergedCell.c1);
  const c2 = Number(mergedCell.c2);
  if (!Number.isFinite(c1) || !Number.isFinite(c2)) return null;
  const visibleStart = Math.max(c1, startIndex + 1);
  const visibleEnd = Math.min(c2, endIndex + 1);
  if (visibleEnd < visibleStart) return null;
  return {
    ...mergedCell,
    c1: visibleStart - startIndex,
    c2: visibleEnd - startIndex,
  };
}

function renderExcelLikeRows(rows, columns, meta = {}, query = "") {
  const firstDataIndex = findFirstDataRowIndex(rows);
  const firstDataRowNumber = firstDataIndex === -1 ? null : rows[firstDataIndex]?.row_number;
  const mergeMap = buildMergeMap(meta.merged_cells || [], rows, columns.length, firstDataRowNumber);
  let stickyTop = 0;
  return rows
    .map((row, rowIndex) => {
      const isHeaderZone = mergeMap.hasMerges
        ? mergeMap.headerRows.has(row.row_number)
        : firstDataIndex === -1
          ? rowIndex < 4
          : rowIndex < firstDataIndex;
      const isTitle = isHeaderZone && isTitleRow(row.cells);
      const isGroup = isGroupRow(row.cells);
      const rowStyle = isHeaderZone ? `style="--header-top:${stickyTop}px"` : "";
      if (isHeaderZone) {
        stickyTop += isTitle ? EXCEL_TITLE_ROW_HEIGHT : EXCEL_HEADER_ROW_HEIGHT;
      }
      const rowClass = [
        isHeaderZone ? "excel-header-row" : "",
        isTitle ? "excel-title-row" : "",
        isGroup ? "excel-group-row" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const rowHeight = getRowHeight("sheet", row.row_number);
      const resizeHandle = `<span class="row-resize-handle" data-resize-row="${row.row_number}" data-resize-scope="sheet"></span>`;
      const rowHeightStyle = rowHeight ? `height:${rowHeight}px;` : "";
      const baseRowStyle = rowStyle ? `${rowStyle.replace(/^style="/, "").replace(/"$/, "")};` : "";
      const finalRowStyle = `${baseRowStyle}${rowHeightStyle}`;
      const rowAttributes = `class="${rowClass}" ${finalRowStyle ? `style="${finalRowStyle}"` : ""}`;

      if (isTitle && !mergeMap.hasMerges) {
        const titleClass = rowHasBold(row) ? "excel-title-cell bold-cell" : "excel-title-cell";
        return `
          <tr ${rowAttributes}>
            <td class="${titleClass}" colspan="${columns.length}">${highlightMatch(bestTitleText(row.cells), query)}${resizeHandle}</td>
          </tr>
        `;
      }

      const cells = isHeaderZone
        ? renderHeaderCells(row, columns.length, mergeMap, isTitle, query)
        : renderBodyCells(row, columns.length, query);
      return `<tr ${rowAttributes}>${cells.replace("</td>", `${resizeHandle}</td>`)}</tr>`;
    })
    .join("");
}

function renderBodyCells(row, columnCount, query = "") {
  const cells = row.cells || [];
  const labelIndex = findRowLabelIndex(cells);
  return Array.from({ length: columnCount }, (_, index) => {
    const value = cells[index] ?? "";
    const className = [
      index === labelIndex ? "row-label-cell" : numericLike(value) ? "number-cell" : "",
      isBoldCell(row, index) ? "bold-cell" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const style = tableCellStyle("sheet", index, index === labelIndex ? `--label-left:${stickyLeftOffset("sheet", index)}px` : "");
    return `<td class="${className}" ${style} title="${escapeHtml(value)}">${formatCellContent(value, query)}${columnResizeHandle("sheet", index)}</td>`;
  }).join("");
}

function renderHeaderCells(row, columnCount, mergeMap, isTitle = false, query = "") {
  const cells = row.cells || [];
  if (!mergeMap.hasMerges) {
    return renderHeuristicHeaderCells(row, columnCount, query);
  }

  let html = "";
  let colNumber = 1;
  while (colNumber <= columnCount) {
    const cellKey = `${row.row_number}:${colNumber}`;
    if (mergeMap.covered.has(cellKey)) {
      colNumber += 1;
      continue;
    }

    const value = cells[colNumber - 1] ?? "";
    const merge = mergeMap.starts.get(cellKey);
    const attributes = merge
      ? `${merge.colSpan > 1 ? ` colspan="${merge.colSpan}"` : ""}${merge.rowSpan > 1 ? ` rowspan="${merge.rowSpan}"` : ""}`
      : "";
    const className = [
      merge ? "excel-merged-header" : "",
      isTitle ? "excel-title-cell" : "",
      isBoldCell(row, colNumber - 1) ? "bold-cell" : "",
    ]
      .filter(Boolean)
      .join(" ");
    html += `<td class="${className}" ${attributes} ${tableCellStyle("sheet", colNumber - 1)} title="${escapeHtml(value)}">${formatCellContent(value, query)}${columnResizeHandle("sheet", colNumber - 1)}</td>`;
    colNumber += merge?.colSpan || 1;
  }
  return html;
}

function renderHeuristicHeaderCells(row, columnCount, query = "") {
  const cells = row.cells || [];
  let html = "";
  let index = 0;
  while (index < columnCount) {
    const value = cells[index] ?? "";
    if (value !== "" && index > 0) {
      let span = 1;
      while (index + span < columnCount && (cells[index + span] ?? "") === "") {
        span += 1;
      }
      const className = ["excel-merged-header", isBoldCell(row, index) ? "bold-cell" : ""].filter(Boolean).join(" ");
      html += `<td class="${className}" colspan="${span}" ${tableCellStyle("sheet", index)} title="${escapeHtml(value)}">${formatCellContent(value, query)}${columnResizeHandle("sheet", index)}</td>`;
      index += span;
    } else {
      const className = isBoldCell(row, index) ? ` class="bold-cell"` : "";
      html += `<td${className} ${tableCellStyle("sheet", index)} title="${escapeHtml(value)}">${formatCellContent(value, query)}${columnResizeHandle("sheet", index)}</td>`;
      index += 1;
    }
  }
  return html;
}

function buildMergeMap(mergedCells, rows, columnCount, firstDataRowNumber) {
  const starts = new Map();
  const covered = new Set();
  const headerRows = new Set();
  const visibleRows = rows.map((row) => row.row_number);
  const visibleRowSet = new Set(visibleRows);

  for (const mergedCell of mergedCells) {
    const merge = normalizeMerge(mergedCell, columnCount);
    if (!merge) continue;

    const isBeforeData = firstDataRowNumber === null || merge.r1 < firstDataRowNumber;
    if (isBeforeData) {
      for (let rowNumber = merge.r1; rowNumber <= merge.r2; rowNumber += 1) {
        if (visibleRowSet.has(rowNumber)) {
          headerRows.add(rowNumber);
        }
      }
    }

    if (!visibleRowSet.has(merge.r1)) {
      continue;
    }

    const visibleSpanRows = visibleRows.filter((rowNumber) => rowNumber >= merge.r1 && rowNumber <= merge.r2);
    const rowSpan = Math.max(1, visibleSpanRows.length);
    const colSpan = merge.c2 - merge.c1 + 1;
    starts.set(`${merge.r1}:${merge.c1}`, { rowSpan, colSpan });

    for (const rowNumber of visibleSpanRows) {
      for (let colNumber = merge.c1; colNumber <= merge.c2; colNumber += 1) {
        if (rowNumber === merge.r1 && colNumber === merge.c1) {
          continue;
        }
        covered.add(`${rowNumber}:${colNumber}`);
      }
    }
  }

  return { starts, covered, headerRows, hasMerges: headerRows.size > 0 };
}

function normalizeMerge(mergedCell, columnCount) {
  const r1 = Number(mergedCell.r1);
  const r2 = Number(mergedCell.r2);
  const c1 = Math.max(1, Number(mergedCell.c1));
  const c2 = Math.min(columnCount, Number(mergedCell.c2));
  if (![r1, r2, c1, c2].every(Number.isFinite)) return null;
  if (r2 < r1 || c2 < c1) return null;
  return { r1, r2, c1, c2 };
}

function findFirstDataRowIndex(rows) {
  return rows.findIndex((row) => isDataRow(row.cells));
}

function isDataRow(cells) {
  return findRowLabelIndex(cells) !== -1 && numericCount(cells) >= 2;
}

function findRowLabelIndex(cells) {
  const searchLimit = Math.min(5, cells.length);
  for (let index = 0; index < searchLimit; index += 1) {
    const value = String(cells[index] ?? "").trim();
    if (value && !numericLike(value)) {
      return index;
    }
  }
  return -1;
}

function numericCount(cells) {
  return cells.filter((cell) => numericLike(cell)).length;
}

function numericLike(value) {
  if (typeof value === "number") return true;
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (/^0\d+$/.test(text)) return false;
  const normalized = text.replace(",", ".");
  return normalized !== "" && !Number.isNaN(Number(normalized));
}

function formatCellContent(value, query = "") {
  return highlightMatch(formatCellValue(value), query);
}

function formatCellValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = String(value).trim();
  if (!text) return "";
  if (/%$/.test(text)) {
    const percentText = text.slice(0, -1).trim();
    if (percentText) {
      const percentNumber = Number(percentText.replace(",", "."));
      if (Number.isFinite(percentNumber)) {
        return `${new Intl.NumberFormat("az-AZ", { maximumFractionDigits: 2 }).format(percentNumber)}%`;
      }
    }
  }
  if (/^0\d+$/.test(text)) return text;
  const normalized = text.replace(/\s/g, "").replace(",", ".");
  if (!normalized || Number.isNaN(Number(normalized))) return text;
  const number = Number(normalized);
  if (Number.isInteger(number) && number >= 1900 && number <= 2100) return text;
  const hasDecimal = normalized.includes(".");
  return new Intl.NumberFormat("az-AZ", {
    minimumFractionDigits: 0,
    maximumFractionDigits: hasDecimal ? 3 : 0,
  }).format(number);
}

function columnStorageKey(scope) {
  if (scope === "merged") return "columnWidths:merged";
  return `columnWidths:sheet:${selectedSheet()?.id || "none"}`;
}

function rowStorageKey(scope) {
  if (scope === "merged") return "rowHeights:merged";
  return `rowHeights:sheet:${selectedSheet()?.id || "none"}`;
}

function storedSizeMap(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function getColumnWidth(scope, index) {
  const widths = storedSizeMap(columnStorageKey(scope));
  return Number(widths[index]) || 0;
}

function setColumnWidth(scope, index, width) {
  const key = columnStorageKey(scope);
  const widths = storedSizeMap(key);
  widths[index] = Math.max(48, Math.round(width));
  localStorage.setItem(key, JSON.stringify(widths));
}

function getRowHeight(scope, rowNumber) {
  const heights = storedSizeMap(rowStorageKey(scope));
  return Number(heights[rowNumber]) || 0;
}

function setRowHeight(scope, rowNumber, height) {
  const key = rowStorageKey(scope);
  const heights = storedSizeMap(key);
  heights[rowNumber] = Math.max(20, Math.round(height));
  localStorage.setItem(key, JSON.stringify(heights));
}

function tableCellStyle(scope, index, extra = "") {
  const width = getColumnWidth(scope, index);
  const parts = [];
  if (width) parts.push(`width:${width}px;min-width:${width}px;max-width:${width}px`);
  if (extra) parts.push(extra);
  return parts.length ? `style="${parts.join(";")}"` : "";
}

function stickyLeftOffset(scope, index) {
  let offset = 0;
  for (let current = 0; current < index; current += 1) {
    offset += getColumnWidth(scope, current) || 66;
  }
  return offset;
}

function columnResizeHandle(scope, index) {
  return `<span class="col-resize-handle" data-resize-col="${index}" data-resize-scope="${scope}"></span>`;
}

function isTitleRow(cells) {
  const values = cells.map((cell) => String(cell ?? "").trim()).filter(Boolean);
  if (!values.length || values.length > 2) return false;
  return values.some((value) => value.length > 18);
}

function bestTitleText(cells) {
  return cells
    .map((cell) => String(cell ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || "";
}

function isGroupRow(cells) {
  const labelIndex = findRowLabelIndex(cells);
  const label = String(cells[labelIndex] ?? "").toLowerCase();
  return label.includes("iqtisadi rayonu") || label.includes("economic region");
}

function renderMergeFileList() {
  const files = mergedVisibleFiles();
  el.mergeFileList.innerHTML = "";

  if (!files.length) {
    el.mergeFileList.innerHTML = emptyMarkup("Hazır fayl yoxdur.", "Faylları import edin və ya bölmə filterini dəyişin.");
    return;
  }

  for (const file of files) {
    const checked = state.selectedMergeFileIds.has(file.id);
    const rowCount = file.sheets.reduce((sum, sheet) => sum + sheet.row_count, 0);
    const item = document.createElement("div");
    item.className = "file-check";
    item.innerHTML = `
      <label>
        <input type="checkbox" data-merge-file="${file.id}" ${checked ? "checked" : ""} />
        <span>${escapeHtml(file.original_name)}</span>
      </label>
      <small class="file-meta">${escapeHtml(file.category_name || "Bölməsiz")} · ${formatNumber(file.sheets.length)} sheet · ${formatNumber(rowCount)} sətir</small>
    `;
    el.mergeFileList.appendChild(item);
  }
}

async function loadMergedRows() {
  el.mergedTableWrap.innerHTML = emptyMarkup("Yüklənir...", "");
  const selectedIds = [...state.selectedMergeFileIds];
  const category = selectedCategory(state.mergedCategoryFilter);

  if (selectedIds.length) {
    el.mergedTitle.textContent = `${formatNumber(selectedIds.length)} seçilmiş fayl`;
  } else if (category) {
    el.mergedTitle.textContent = `${category.name} bölməsi`;
  } else {
    el.mergedTitle.textContent = "Bütün Excel dataları";
  }

  try {
    const params = new URLSearchParams({
      offset: state.mergedOffset,
      limit: state.mergedLimit,
      q: state.search,
    });
    if (state.mergedCategoryFilter) params.set("category_id", state.mergedCategoryFilter);
    if (selectedIds.length) params.set("file_ids", selectedIds.join(","));

    const data = await api(`/api/merged/rows?${params.toString()}`);
    renderMergedTable(data);
  } catch (error) {
    el.mergedTableWrap.innerHTML = emptyMarkup("Birləşmiş data yüklənmədi.", error.message);
  }
}

function renderMergedTable(data) {
  const rows = data.rows || [];
  if (!rows.length) {
    el.mergedTableWrap.innerHTML = emptyMarkup("Data tapılmadı.", "Filterləri və ya axtarışı dəyişin.");
    el.mergedPageInfo.textContent = "0-0";
    el.mergedSearchCount.textContent = "0 netice";
    state.currentMergedData = data;
    setMergedPager(state.mergedOffset > 0, false);
    return;
  }

  const columns = data.columns || [];
  const query = state.search;
  state.currentMergedData = { ...data };
  el.mergedSearchCount.textContent = state.search
    ? `${formatNumber(data.total)} netice`
    : `${formatNumber(data.total)} setir`;
  const body = rows
    .map((row) => {
      const cells = columns
        .map((_, index) => {
          const value = row.cells[index] ?? "";
          const className = isBoldCell(row, index) ? ` class="bold-cell"` : "";
          return `<td${className} ${tableCellStyle("merged", index)} title="${escapeHtml(value)}">${formatCellContent(value, query)}${columnResizeHandle("merged", index)}</td>`;
        })
        .join("");
      return `
        <tr>
          <td class="meta-head">${row.row_number}</td>
          <td class="meta-col" title="${escapeHtml(row.category_name || "Bölməsiz")}">${escapeHtml(row.category_name || "Bölməsiz")}</td>
          <td class="meta-col" title="${escapeHtml(row.file_name)}">${escapeHtml(row.file_name)}</td>
          <td class="meta-col" title="${escapeHtml(row.sheet_name)}">${escapeHtml(row.sheet_name)}</td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  el.mergedTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th class="meta-head">Sətir</th>
          <th class="meta-col">Bölmə</th>
          <th class="meta-col">Fayl</th>
          <th class="meta-col">Sheet</th>
          ${columns.map((column, index) => `<th ${tableCellStyle("merged", index)}>${escapeHtml(column)}${columnResizeHandle("merged", index)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;

  const start = data.offset + 1;
  const end = data.offset + rows.length;
  el.mergedPageInfo.textContent = `${formatNumber(start)}-${formatNumber(end)} / ${formatNumber(data.total)}`;
  setMergedPager(state.mergedOffset > 0, end < data.total);
}

function setSheetPager(canPrev, canNext) {
  el.prevPage.disabled = !canPrev;
  el.nextPage.disabled = !canNext;
}

function setMergedPager(canPrev, canNext) {
  el.mergedPrevPage.disabled = !canPrev;
  el.mergedNextPage.disabled = !canNext;
}

function sheetExportRows() {
  const view = state.currentSheetData?.view;
  if (!view?.rows?.length) return { headers: view?.columns || [], rows: [] };
  return {
    headers: view.columns,
    rows: view.rows.map((row) => view.columns.map((_, index) => formatCellValue(row.cells[index] ?? ""))),
  };
}

function mergedExportRows() {
  const data = state.currentMergedData;
  if (!data?.rows?.length) return { headers: [], rows: [] };
  const headers = ["Setir", "Bolme", "Fayl", "Sheet", ...(data.columns || [])];
  const rows = data.rows.map((row) => [
    row.row_number,
    row.category_name || "Bolmesiz",
    row.file_name,
    row.sheet_name,
    ...(data.columns || []).map((_, index) => formatCellValue(row.cells[index] ?? "")),
  ]);
  return { headers, rows };
}

function exportTable(kind) {
  const payload = kind === "merged" ? mergedExportRows() : sheetExportRows();
  if (!payload.rows.length) {
    showToast("Export ucun data yoxdur.");
    return;
  }
  const csv = [payload.headers, ...payload.rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const filename = `${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadText(filename, csv, "text/csv;charset=utf-8");
}

async function copyTable(kind) {
  const payload = kind === "merged" ? mergedExportRows() : sheetExportRows();
  if (!payload.rows.length) {
    showToast("Copy ucun data yoxdur.");
    return;
  }
  const text = [payload.headers, ...payload.rows].map((row) => row.join("\t")).join("\n");
  await navigator.clipboard.writeText(text);
  showToast("Gorunen data clipboard-a kopyalandi.");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toggleFullscreen(panel) {
  panel.classList.toggle("fullscreen-panel");
  document.body.classList.toggle("table-fullscreen-active", panel.classList.contains("fullscreen-panel"));
}

function startResize(event) {
  const colHandle = event.target.closest("[data-resize-col]");
  const rowHandle = event.target.closest("[data-resize-row]");
  if (!colHandle && !rowHandle) return;
  event.preventDefault();
  event.stopPropagation();

  if (colHandle) {
    const scope = colHandle.dataset.resizeScope;
    const index = Number(colHandle.dataset.resizeCol);
    const cell = colHandle.closest("td, th");
    const startX = event.clientX;
    const startWidth = cell.getBoundingClientRect().width;

    const move = (moveEvent) => {
      const width = Math.max(48, startWidth + moveEvent.clientX - startX);
      applyColumnWidth(scope, index, width);
    };
    const up = (upEvent) => {
      const width = Math.max(48, startWidth + upEvent.clientX - startX);
      setColumnWidth(scope, index, width);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return;
  }

  const scope = rowHandle.dataset.resizeScope;
  const rowNumber = Number(rowHandle.dataset.resizeRow);
  const row = rowHandle.closest("tr");
  const startY = event.clientY;
  const startHeight = row.getBoundingClientRect().height;
  const move = (moveEvent) => {
    row.style.height = `${Math.max(20, startHeight + moveEvent.clientY - startY)}px`;
  };
  const up = (upEvent) => {
    setRowHeight(scope, rowNumber, startHeight + upEvent.clientY - startY);
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function applyColumnWidth(scope, index, width) {
  document.querySelectorAll(`[data-resize-scope="${scope}"][data-resize-col="${index}"]`).forEach((handle) => {
    const cell = handle.closest("td, th");
    if (!cell) return;
    cell.style.width = `${width}px`;
    cell.style.minWidth = `${width}px`;
    cell.style.maxWidth = `${width}px`;
  });
}

function selectedFile() {
  return state.files.find((file) => file.id === state.selectedFileId) || null;
}

function selectedSheet() {
  const file = selectedFile();
  return file?.sheets?.find((sheet) => sheet.id === state.selectedSheetId) || null;
}

function selectedCategory(categoryId) {
  return state.categories.find((category) => String(category.id) === String(categoryId)) || null;
}

function firstReadyFile() {
  return state.files.find((file) => file.status === "ready") || null;
}

function filesByCategory(categoryId) {
  const categoryIds = categoryDescendantIds(categoryId);
  return state.files.filter((file) => categoryIds.has(file.category_id));
}

function directFilesByCategory(categoryId) {
  return state.files.filter((file) => file.category_id === categoryId);
}

function categoryHasChildren(categoryId) {
  return state.categories.some((category) => Number(category.parent_id) === Number(categoryId));
}

function isCategoryVisibleInTree(category) {
  const parentId = category.parent_id;
  if (!parentId) return true;

  let currentParentId = parentId;
  while (currentParentId) {
    if (!state.expandedCategoryIds.has(Number(currentParentId))) return false;
    const parent = selectedCategory(currentParentId);
    currentParentId = parent?.parent_id || null;
  }
  return true;
}

function expandCategoryPath(categoryId, { includeSelf = false } = {}) {
  const category = selectedCategory(categoryId);
  if (!category) return;

  if (includeSelf && categoryHasChildren(category.id)) {
    state.expandedCategoryIds.add(Number(category.id));
  }

  let parentId = category.parent_id;
  while (parentId) {
    state.expandedCategoryIds.add(Number(parentId));
    parentId = selectedCategory(parentId)?.parent_id || null;
  }
  persistExpandedCategories();
}

function persistExpandedCategories() {
  localStorage.setItem("expandedCategoryIds", JSON.stringify([...state.expandedCategoryIds]));
}

function categoryDescendantIds(categoryId) {
  const result = new Set();
  const stack = [Number(categoryId)];
  while (stack.length) {
    const current = stack.pop();
    if (!current || result.has(current)) continue;
    result.add(current);
    for (const category of state.categories) {
      if (category.parent_id === current) {
        stack.push(category.id);
      }
    }
  }
  return result;
}

function categoryOptionLabel(category) {
  const indent = "  ".repeat(category.level || 0);
  return `${indent}${category.level ? "└ " : ""}${category.path || category.name}`;
}

function fileSearchText(file) {
  return [
    file.original_name,
    file.category_name || "",
    statusLabel(file.status),
    ...file.sheets.map((sheet) => sheet.name),
    ...file.sheets.map((sheet) => sheet.heading_text || ""),
  ]
    .join(" ")
    .toLowerCase();
}

function matchedHeadingSnippet(file, query) {
  if (!query) return "";
  const normalizedQuery = query.toLowerCase();
  for (const sheet of file.sheets || []) {
    const heading = String(sheet.heading_text || "").replace(/\s+/g, " ").trim();
    const index = heading.toLowerCase().indexOf(normalizedQuery);
    if (index === -1) continue;
    const start = Math.max(0, index - 45);
    const end = Math.min(heading.length, index + normalizedQuery.length + 90);
    const prefix = start > 0 ? "... " : "";
    const suffix = end < heading.length ? " ..." : "";
    return `${sheet.name}: ${prefix}${heading.slice(start, end)}${suffix}`;
  }
  return "";
}

function highlightMatch(value, query) {
  const text = String(value ?? "");
  const needle = String(query || "").trim();
  if (!needle) return escapeHtml(text);

  const normalizedText = text.toLowerCase();
  const normalizedNeedle = needle.toLowerCase();
  let cursor = 0;
  let html = "";

  while (cursor < text.length) {
    const index = normalizedText.indexOf(normalizedNeedle, cursor);
    if (index === -1) {
      html += escapeHtml(text.slice(cursor));
      break;
    }
    html += escapeHtml(text.slice(cursor, index));
    html += `<mark class="search-hit">${escapeHtml(text.slice(index, index + needle.length))}</mark>`;
    cursor = index + needle.length;
  }

  return html;
}

function mergedVisibleFiles() {
  return state.files.filter((file) => {
    if (file.status !== "ready") return false;
    if (state.mergedCategoryFilter && !categoryDescendantIds(Number(state.mergedCategoryFilter)).has(file.category_id)) return false;
    return true;
  });
}

function setupPolling() {
  const shouldPoll = state.files.some((file) => file.status === "queued" || file.status === "importing");
  window.clearInterval(state.polling);
  state.polling = null;
  if (shouldPoll) {
    state.polling = window.setInterval(() => loadData({ keepSelection: true }).catch(console.error), 2500);
  }
}

async function uploadFiles(files) {
  if (!files.length) return;
  const form = new FormData();
  const categoryId = el.uploadCategorySelect.value;
  if (categoryId) form.append("category_id", categoryId);
  for (const file of files) {
    form.append("files", file);
  }

  try {
    await adminApi("/api/files", { method: "POST", body: form });
    showToast("Fayl yükləndi, import başladı.");
    state.view = "files";
    await loadData({ keepSelection: false });
  } catch (error) {
    showToast(error.message);
  } finally {
    el.fileInput.value = "";
  }
}

async function updateFileCategory(fileId, categoryId) {
  try {
    await adminApi(`/api/files/${fileId}/category`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: categoryId || null }),
    });
    showToast("Fayl bölməsi yeniləndi.");
    await loadData({ keepSelection: true });
  } catch (error) {
    showToast(error.message);
  }
}

async function renameFile(fileId) {
  const file = state.files.find((item) => item.id === fileId);
  const input = document.querySelector(`[data-file-name-input="${fileId}"]`);
  const name = String(input?.value || "").trim();

  if (!file || !name) {
    showToast("Fayl adı boş ola bilməz.");
    return;
  }
  if (name === file.original_name) {
    showToast("Fayl adı dəyişməyib.");
    return;
  }

  try {
    await adminApi(`/api/files/${fileId}/name`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    showToast("Fayl adı yeniləndi.");
    await loadData({ keepSelection: true });
  } catch (error) {
    showToast(error.message);
  }
}

async function createCategory(name, parentId = null) {
  try {
    await adminApi("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parent_id: parentId || null }),
    });
    el.newCategoryName.value = "";
    el.newCategoryParent.value = "";
    showToast("Bölmə əlavə olundu.");
    await loadData({ keepSelection: true });
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteCategory(categoryId) {
  const category = selectedCategory(categoryId);
  if (!category) return;

  const filesCount = directFilesByCategory(categoryId).length;
  const message = filesCount
    ? `${category.name} bölməsi silinsin? Bu bölmədəki ${formatNumber(filesCount)} fayl Bölməsiz olacaq.`
    : `${category.name} bölməsi silinsin?`;
  if (!window.confirm(message)) return;

  try {
    const result = await adminApi(`/api/categories/${categoryId}`, { method: "DELETE" });
    if (state.fileCategoryFilter === String(categoryId)) state.fileCategoryFilter = "";
    if (state.mergedCategoryFilter === String(categoryId)) state.mergedCategoryFilter = "";
    showToast(`Bölmə silindi. ${formatNumber(result.files_uncategorized)} fayl Bölməsiz oldu.`);
    await loadData({ keepSelection: true });
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteFile(fileId) {
  const file = state.files.find((item) => item.id === fileId);
  if (!file || !window.confirm(`${file.original_name} silinsin?`)) return;

  try {
    await adminApi(`/api/files/${fileId}`, { method: "DELETE" });
    state.selectedMergeFileIds.delete(fileId);
    showToast("Fayl silindi.");
    await loadData({ keepSelection: false });
  } catch (error) {
    showToast(error.message);
  }
}

async function reimportFile(fileId) {
  try {
    await adminApi(`/api/files/${fileId}/reimport`, { method: "POST" });
    showToast("Yenidən import başladı.");
    await loadData({ keepSelection: true });
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteAllFiles() {
  if (!state.files.length) {
    showToast("Silinəcək fayl yoxdur.");
    return;
  }

  const confirmed = window.confirm("Bütün yüklənmiş Excel faylları, sheet-lər və import dataları silinsin?");
  if (!confirmed) return;

  const finalConfirmed = window.confirm("Bu əməliyyat geri qaytarılmır. Davam edilsin?");
  if (!finalConfirmed) return;

  try {
    const result = await adminApi("/api/files", { method: "DELETE" });
    state.selectedMergeFileIds.clear();
    showToast(`${formatNumber(result.files)} fayl silindi.`);
    await loadData({ keepSelection: false });
  } catch (error) {
    showToast(error.message);
  }
}

function openFile(fileId) {
  const file = state.files.find((item) => item.id === fileId);
  if (!file) return;
  if (file.status !== "ready") {
    showToast("Import tamamlanandan sonra baxmaq olar.");
    return;
  }
  pushViewHistory();
  state.selectedFileId = file.id;
  state.selectedSheetId = file.sheets[0]?.id || null;
  renderFileControls();
  switchView("viewer", { recordHistory: false });
}

function mergeOneFile(fileId) {
  pushViewHistory();
  state.selectedMergeFileIds = new Set([fileId]);
  state.mergedCategoryFilter = "";
  state.mergedOffset = 0;
  switchView("merged", { recordHistory: false });
}

function openCategoryFiles(categoryId) {
  pushViewHistory();
  state.fileCategoryFilter = String(categoryId);
  switchView("files", { recordHistory: false });
}

function mergeCategory(categoryId) {
  pushViewHistory();
  state.mergedCategoryFilter = String(categoryId);
  state.selectedMergeFileIds.clear();
  state.mergedOffset = 0;
  switchView("merged", { recordHistory: false });
}

function prepareSubCategory(categoryId) {
  if (!state.isAdmin) return;
  renderCategoryOptions();
  el.newCategoryParent.value = String(categoryId);
  el.newCategoryName.focus();
}

async function submitAdminLogin(username, password) {
  state.adminAuth = `Basic ${btoa(`${username}:${password}`)}`;
  sessionStorage.setItem("adminAuth", state.adminAuth);
  await checkSession();

  if (state.isAdmin) {
    closeAdminModal();
    showToast("Admin girişi aktivdir.");
    renderActiveView();
  } else {
    showToast("Admin məlumatları yanlışdır.");
  }
}

function openAdminModal() {
  el.adminModal.classList.remove("hidden");
  el.adminUsername.focus();
}

function closeAdminModal() {
  el.adminModal.classList.add("hidden");
  el.adminPassword.value = "";
}

function adminLogout() {
  state.isAdmin = false;
  state.adminAuth = "";
  sessionStorage.removeItem("adminAuth");
  applyAdminState();
  renderActiveView();
  showToast("Admin çıxışı edildi.");
}

function emptyMarkup(title, subtitle) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(callback, delay = 250) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

el.navItems.forEach((item) => item.addEventListener("click", () => switchView(item.dataset.view)));
el.fileInput.addEventListener("change", (event) => uploadFiles([...event.target.files]));
el.refreshBtn.addEventListener("click", () => loadData().catch((error) => showToast(error.message)));
el.backBtn.addEventListener("click", () => goBack());
el.themeToggle.addEventListener("click", () => {
  state.theme = state.theme === "dim" ? "light" : "dim";
  localStorage.setItem("theme", state.theme);
  renderUiPreferences();
});
el.adminLoginBtn.addEventListener("click", () => openAdminModal());
el.adminLogoutBtn.addEventListener("click", () => adminLogout());
el.adminModalCancel.addEventListener("click", () => closeAdminModal());
el.adminModal.addEventListener("click", (event) => {
  if (event.target === el.adminModal) closeAdminModal();
});
el.adminLoginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAdminLogin(el.adminUsername.value.trim(), el.adminPassword.value).catch((error) => showToast(error.message));
});
el.deleteAllFilesBtn.addEventListener("click", () => deleteAllFiles());

el.fileLayoutButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filesLayout = button.dataset.filesLayout;
    localStorage.setItem("filesLayout", state.filesLayout);
    renderUiPreferences();
    renderFilesPage();
  });
});

el.tableModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.tableMode = button.dataset.tableMode;
    localStorage.setItem("tableMode", state.tableMode);
    renderUiPreferences();
    loadSheetRows();
  });
});

el.clearTreeFilter.addEventListener("click", () => {
  pushViewHistory();
  state.fileCategoryFilter = "";
  el.fileCategoryFilter.value = "";
  switchView("files", { recordHistory: false });
  renderCategoryTree();
});

el.globalSearch.addEventListener(
  "input",
  debounce((event) => {
    state.search = event.target.value.trim();
    state.sheetOffset = 0;
    state.mergedOffset = 0;
    renderActiveView();
  }),
);

el.fileCategoryFilter.addEventListener("change", () => {
  state.fileCategoryFilter = el.fileCategoryFilter.value;
  if (state.fileCategoryFilter && state.fileCategoryFilter !== "none") {
    expandCategoryPath(Number(state.fileCategoryFilter), { includeSelf: true });
  }
  renderCategoryTree();
  renderFilesPage();
});

el.fileStatusFilter.addEventListener("change", () => {
  state.fileStatusFilter = el.fileStatusFilter.value;
  renderFilesPage();
});

el.fileSort.addEventListener("change", () => {
  state.fileSort = el.fileSort.value;
  renderFileControls();
  renderFilesPage();
});

el.viewerFileSearch.addEventListener(
  "input",
  debounce((event) => {
    state.viewerFileSearch = event.target.value.trim();
    renderFileControls();
    loadSheetRows();
  }),
);

el.addCategoryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = el.newCategoryName.value.trim();
  const parentId = Number(el.newCategoryParent.value) || null;
  if (name) createCategory(name, parentId);
});

el.fileSelect.addEventListener("change", () => {
  state.selectedFileId = Number(el.fileSelect.value) || null;
  state.selectedSheetId = selectedFile()?.sheets?.[0]?.id || null;
  state.sheetOffset = 0;
  renderSheetSelect();
  loadSheetRows();
});

el.sheetSelect.addEventListener("change", () => {
  state.selectedSheetId = Number(el.sheetSelect.value) || null;
  state.sheetOffset = 0;
  loadSheetRows();
});

el.prevPage.addEventListener("click", () => {
  state.sheetOffset = Math.max(0, state.sheetOffset - state.sheetLimit);
  loadSheetRows();
});

el.nextPage.addEventListener("click", () => {
  state.sheetOffset += state.sheetLimit;
  loadSheetRows();
});

el.pageSize.addEventListener("change", () => {
  state.sheetLimit = Number(el.pageSize.value);
  state.sheetOffset = 0;
  loadSheetRows();
});

el.copySheetBtn.addEventListener("click", () => copyTable("sheet").catch((error) => showToast(error.message)));
el.exportSheetBtn.addEventListener("click", () => exportTable("sheet"));
el.fullscreenSheetBtn.addEventListener("click", () => toggleFullscreen(el.tableWrap.closest(".table-panel")));

el.mergedCategoryFilter.addEventListener("change", () => {
  state.mergedCategoryFilter = el.mergedCategoryFilter.value;
  state.selectedMergeFileIds.clear();
  state.mergedOffset = 0;
  renderMergeFileList();
  loadMergedRows();
});

el.selectVisibleFiles.addEventListener("click", () => {
  state.selectedMergeFileIds = new Set(mergedVisibleFiles().map((file) => file.id));
  state.mergedOffset = 0;
  renderMergeFileList();
  loadMergedRows();
});

el.clearSelectedFiles.addEventListener("click", () => {
  state.selectedMergeFileIds.clear();
  state.mergedOffset = 0;
  renderMergeFileList();
  loadMergedRows();
});

el.mergeFileList.addEventListener("change", (event) => {
  const target = event.target.closest("[data-merge-file]");
  if (!target) return;
  const fileId = Number(target.dataset.mergeFile);
  if (target.checked) {
    state.selectedMergeFileIds.add(fileId);
  } else {
    state.selectedMergeFileIds.delete(fileId);
  }
  state.mergedOffset = 0;
  loadMergedRows();
});

el.mergedPrevPage.addEventListener("click", () => {
  state.mergedOffset = Math.max(0, state.mergedOffset - state.mergedLimit);
  loadMergedRows();
});

el.mergedNextPage.addEventListener("click", () => {
  state.mergedOffset += state.mergedLimit;
  loadMergedRows();
});

el.mergedPageSize.addEventListener("change", () => {
  state.mergedLimit = Number(el.mergedPageSize.value);
  state.mergedOffset = 0;
  loadMergedRows();
});

el.copyMergedBtn.addEventListener("click", () => copyTable("merged").catch((error) => showToast(error.message)));
el.exportMergedBtn.addEventListener("click", () => exportTable("merged"));
el.fullscreenMergedBtn.addEventListener("click", () => toggleFullscreen(el.mergedTableWrap.closest(".table-panel")));

el.categoryTree.addEventListener("click", (event) => {
  const target = event.target.closest("[data-tree-category]");
  if (!target) return;
  pushViewHistory();
  const categoryId = Number(target.dataset.treeCategory);
  const wasActive = String(categoryId) === String(state.fileCategoryFilter);
  const hasChildren = target.dataset.hasChildren === "1";

  if (hasChildren) {
    if (wasActive && state.expandedCategoryIds.has(categoryId)) {
      state.expandedCategoryIds.delete(categoryId);
    } else {
      state.expandedCategoryIds.add(categoryId);
    }
    persistExpandedCategories();
  }

  expandCategoryPath(categoryId);
  state.fileCategoryFilter = String(categoryId);
  el.fileCategoryFilter.value = state.fileCategoryFilter;
  switchView("files", { recordHistory: false });
  renderCategoryTree();
});

document.addEventListener("mousedown", startResize);

el.filesGrid.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const fileId = Number(target.dataset.id);
  if (target.dataset.action === "view") openFile(fileId);
  if (target.dataset.action === "merge-one") mergeOneFile(fileId);
  if (target.dataset.action === "rename") renameFile(fileId);
  if (target.dataset.action === "delete") deleteFile(fileId);
  if (target.dataset.action === "reimport") reimportFile(fileId);
});

el.filesGrid.addEventListener("change", (event) => {
  const target = event.target.closest("[data-file-category]");
  if (!target) return;
  updateFileCategory(Number(target.dataset.fileCategory), target.value ? Number(target.value) : null);
});

el.categoryGrid.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const categoryId = Number(target.dataset.id);
  if (target.dataset.action === "open-category") openCategoryFiles(categoryId);
  if (target.dataset.action === "merge-category") mergeCategory(categoryId);
  if (target.dataset.action === "sub-category") prepareSubCategory(categoryId);
  if (target.dataset.action === "delete-category") deleteCategory(categoryId);
});

for (const eventName of ["dragenter", "dragover"]) {
  el.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    el.uploadZone.classList.add("dragover");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  el.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    el.uploadZone.classList.remove("dragover");
  });
}

el.uploadZone.addEventListener("drop", (event) => uploadFiles([...event.dataTransfer.files]));

renderUiPreferences();
checkSession()
  .then(() => loadData({ keepSelection: false }))
  .catch((error) => showToast(error.message));
