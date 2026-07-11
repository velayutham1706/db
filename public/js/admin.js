import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, deleteDoc,
  updateDoc, doc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

// NOTE: this is a client-side gate only — it keeps casual visitors out,
// it does not stop anyone who opens dev tools. Real write protection
// has to come from Firestore security rules tied to an authenticated
// admin UID. Worth tightening separately from this upload feature.
const ADMIN_PASS = '15072003';
window.checkPass = function() {
  const v = document.getElementById('admin-pass').value;
  if (v === ADMIN_PASS) {
    document.getElementById('auth-wall').style.display = 'none';
    init();
  } else {
    document.getElementById('pass-err').style.display = 'block';
    document.getElementById('admin-pass').value = '';
    document.getElementById('admin-pass').focus();
  }
};

let db, tracks = [], editDocId = null;
let pendingCoverBlob = null;   // base64 cover art from ID3
let uploadedUrl = null;        // secure_url once Cloudinary upload finishes
let uploadInFlight = false;

async function init() {
  try {
    const res = await fetch('/api/firebase-config');
    const config = await res.json();
    const app = initializeApp(config);
    db = getFirestore(app);
    const auth = getAuth(app);
    await signInWithEmailAndPassword(auth, "admin@dbhifi.com", "!@#Dbhifi15072003");
    await loadTracks();
  } catch (e) {
    showToast('Failed to connect: ' + e.message);
  }
}

async function loadTracks() {
  try {
    const q = query(collection(db, 'tracks'), orderBy('order', 'asc'));
    const snap = await getDocs(q);
    tracks = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
    renderTable();
    const n = tracks.length;
    document.getElementById('track-count').textContent = `${n} track${n !== 1 ? 's' : ''}`;
    document.getElementById('list-count').textContent = `${n} tracks`;
    const maxOrder = tracks.reduce((m, t) => Math.max(m, t.order ?? 0), -1);
    document.getElementById('f-order').value = maxOrder + 1;
  } catch (e) {
    document.getElementById('track-list-wrap').innerHTML =
      `<div class="empty-state" style="color:var(--red)"><p>Error loading tracks: ${e.message}</p></div>`;
  }
}

function renderTable() {
  if (!tracks.length) {
    document.getElementById('track-list-wrap').innerHTML =
      `<div class="empty-state"><div style="font-size:32px">🎵</div><p>No tracks yet. Add your first track above.</p></div>`;
    return;
  }
  document.getElementById('track-list-wrap').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>#</th><th></th><th>Title</th><th>Artist</th><th>Genre</th><th>Language</th><th>Album</th><th>URL</th><th>Actions</th>
        </tr></thead>
        <tbody>${tracks.map((t, i) => `
          <tr>
            <td><input class="order-input" type="number" value="${t.order ?? i}" onchange="updateOrder('${t._docId}', this.value)"></td>
            <td>${t.coverUrl
      ? `<img class="track-art" src="${t.coverUrl}" alt="${t.title}">`
      : `<div class="track-art-placeholder">🎵</div>`
    }</td>
            <td><strong style="font-size:12px">${t.title}</strong></td>
            <td>${t.artist}</td>
            <td><span class="badge">${t.genre || '—'}</span></td>
            <td>${t.language || '—'}</td>
            <td style="font-size:10px;color:var(--muted)">${t.album || '—'}</td>
            <td><div class="url-cell" title="${t.url}">${t.url}</div></td>
            <td style="white-space:nowrap;gap:6px">
              <button class="btn btn-edit" onclick="openEdit('${t._docId}')">✎ Edit</button>
              <button class="btn btn-danger" onclick="deleteTrack('${t._docId}', '${(t.title || '').replace(/'/g, "\\'")}')">✕</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

const ACCEPTED_EXT = ['mp3', 'm4a', 'flac'];

function extOf(filename) {
  return (filename.split('.').pop() || '').toLowerCase();
}

window.onDropzoneDragOver = function(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.add('drag-over');
};
window.onDropzoneDragLeave = function() {
  document.getElementById('dropzone').classList.remove('drag-over');
};
window.onDropzoneDrop = function(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
};
window.onFileInputChange = function(e) {
  const file = e.target.files[0];
  if (file) handleFile(file);
};

function handleFile(file) {
  const ext = extOf(file.name);
  if (!ACCEPTED_EXT.includes(ext)) {
    showToast(`Unsupported file type ".${ext}" — use mp3, m4a or flac`);
    return;
  }

  uploadedUrl = null;
  document.getElementById('add-btn').disabled = true;
  setStatus('loading', `Reading tags from ${file.name}...`);
  document.getElementById('dz-filename').textContent = file.name;

  // Reading ID3 tags directly off the local file
  window.jsmediatags.read(file, {
    onSuccess(tag) {
      const tags = tag.tags || {};
      autoFill('f-title', tags.title || '');
      autoFill('f-artist', tags.artist || '');
      autoFill('f-album', tags.album || '');

      let genre = tags.genre || '';
      genre = genre.replace(/^\(\d+\)/, '').trim();
      autoFill('f-genre', genre);

      const pic = tags.picture;
      if (pic) {
        const blob = new Blob([new Uint8Array(pic.data)], { type: pic.format });
        const reader = new FileReader();
        reader.onload = () => {
          pendingCoverBlob = reader.result;
          document.getElementById('cover-preview').innerHTML = `<img src="${pendingCoverBlob}" alt="cover">`;
        };
        reader.readAsDataURL(blob);
      } else {
        pendingCoverBlob = null;
        document.getElementById('cover-preview').innerHTML = '<span>No Cover</span>';
      }
    },
    onError(err) {
      // Not fatal — fields can still be filled manually.
      console.warn('ID3 read failed:', err);
    }
  });

  uploadToCloudinary(file);
}

async function uploadToCloudinary(file) {
  uploadInFlight = true;
  const progWrap = document.getElementById('upload-progress-wrap');
  const bar = document.getElementById('upload-progress-bar');
  progWrap.style.display = 'block';
  bar.style.width = '0%';
  setStatus('loading', `Uploading ${file.name}...`);

  try {
    const signRes = await fetch('/api/cloudinary-sign', { method: 'POST' });
    if (!signRes.ok) throw new Error('Could not get upload signature');
    const { signature, timestamp, folder, apiKey, cloudName } = await signRes.json();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', folder);

    const result = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`);
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          bar.style.width = pct + '%';
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Cloudinary upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });

    uploadedUrl = result.secure_url;
    document.getElementById('f-url').value = uploadedUrl;
    setStatus('success', `✓ Uploaded — ${document.getElementById('f-title').value ? 'tags filled, ' : ''}ready to save.`);
    document.getElementById('add-btn').disabled = false;
  } catch (e) {
    setStatus('error', `Upload failed: ${e.message}`);
  } finally {
    uploadInFlight = false;
    setTimeout(() => { progWrap.style.display = 'none'; }, 800);
  }
}

function autoFill(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  if (val) {
    el.classList.add('auto-filled');
    setTimeout(() => el.classList.remove('auto-filled'), 2000);
  }
}

function setStatus(type, msg) {
  const el = document.getElementById('id3-status');
  el.className = `status-bar ${type}`;
  el.textContent = msg;
}

// ── ADD TRACK ──
window.addTrack = async function() {
  const url = document.getElementById('f-url').value.trim();
  const title = document.getElementById('f-title').value.trim();
  const artist = document.getElementById('f-artist').value.trim();

  if (uploadInFlight) { showToast('Upload still in progress...'); return; }
  if (!url) { showToast('Please upload a file first'); return; }
  if (!title) { showToast('Title is required'); document.getElementById('f-title').focus(); return; }
  if (!artist) { showToast('Artist is required'); document.getElementById('f-artist').focus(); return; }

  const btn = document.getElementById('add-btn');
  const status = document.getElementById('add-status');
  btn.disabled = true;
  status.textContent = 'Saving to Firestore...';

  const maxId = tracks.reduce((m, t) => Math.max(m, t.id ?? -1), -1);
  const order = parseInt(document.getElementById('f-order').value) || maxId + 1;

  try {
    await addDoc(collection(db, 'tracks'), {
      id: maxId + 1,
      title,
      artist,
      album: document.getElementById('f-album').value.trim() || '',
      genre: document.getElementById('f-genre').value.trim() || '',
      language: document.getElementById('f-language').value.trim() || '',
      url,
      coverUrl: pendingCoverBlob || null,
      order,
      addedAt: serverTimestamp()
    });

    showToast(`✓ "${title}" added!`);
    clearForm();
    await loadTracks();
  } catch (e) {
    showToast('Error saving: ' + e.message);
    btn.disabled = false;
  }
  status.textContent = '';
};

window.deleteTrack = async function(docId, title) {
  if (!confirm(`Delete "${title}"?\n\nThis cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, 'tracks', docId));
    showToast(`Deleted "${title}"`);
    await loadTracks();
  } catch (e) { showToast('Error: ' + e.message); }
};

window.updateOrder = async function(docId, val) {
  try {
    await updateDoc(doc(db, 'tracks', docId), { order: parseInt(val) || 0 });
    showToast('Order updated');
  } catch (e) { showToast('Error: ' + e.message); }
};

// ── EDIT MODAL ──
window.openEdit = function(docId) {
  const t = tracks.find(x => x._docId === docId);
  if (!t) return;
  editDocId = docId;

  document.getElementById('edit-url').value = t.url || '';
  document.getElementById('edit-title').value = t.title || '';
  document.getElementById('edit-artist').value = t.artist || '';
  document.getElementById('edit-album').value = t.album || '';
  document.getElementById('edit-genre').value = t.genre || '';
  document.getElementById('edit-language').value = t.language || '';
  document.getElementById('edit-order').value = t.order ?? 0;

  const cp = document.getElementById('edit-cover-preview');
  cp.innerHTML = t.coverUrl
    ? `<img src="${t.coverUrl}" alt="${t.title}" style="width:100%;height:100%;object-fit:cover">`
    : '<span>No Cover</span>';

  document.getElementById('edit-modal').style.display = 'flex';
};

window.closeEdit = function() {
  document.getElementById('edit-modal').style.display = 'none';
  editDocId = null;
};

window.saveEdit = async function() {
  if (!editDocId) return;
  const data = {
    url: document.getElementById('edit-url').value.trim(),
    title: document.getElementById('edit-title').value.trim(),
    artist: document.getElementById('edit-artist').value.trim(),
    album: document.getElementById('edit-album').value.trim(),
    genre: document.getElementById('edit-genre').value.trim(),
    language: document.getElementById('edit-language').value.trim(),
    order: parseInt(document.getElementById('edit-order').value) || 0,
  };
  if (!data.title || !data.artist) { showToast('Title and Artist are required'); return; }
  try {
    await updateDoc(doc(db, 'tracks', editDocId), data);
    showToast('✓ Track updated');
    closeEdit();
    await loadTracks();
  } catch (e) { showToast('Error: ' + e.message); }
};

window.clearForm = function() {
  ['f-title', 'f-artist', 'f-album', 'f-genre', 'f-language'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('f-url').value = '';
  document.getElementById('dz-filename').textContent = '';
  document.getElementById('file-input').value = '';
  document.getElementById('cover-preview').innerHTML = '<span>Cover Art</span>';
  document.getElementById('id3-status').className = 'status-bar';
  document.getElementById('add-btn').disabled = true;
  document.getElementById('add-status').textContent = '';
  pendingCoverBlob = null;
  uploadedUrl = null;
  const maxOrder = tracks.reduce((m, t) => Math.max(m, t.order ?? 0), -1);
  document.getElementById('f-order').value = maxOrder + 1;
};

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
window.showToast = showToast;
