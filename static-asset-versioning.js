'use strict';

// Fase 5A: versões derivadas dos bytes publicados, sem mudar HTML no repositório.
// HTML é preparado uma única vez ao iniciar o servidor; nada é calculado por request.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSIONED_FILES = new Set([
  'styles.css', 'app.js', 'camera-floating.js', 'camera-video.js',
  'tournament-dashboard.js', 'tournament-ui.js', 'manifest.webmanifest',
  'assets/app/icon-64.png', 'assets/app/icon-180.png', 'assets/app/icon-512.png',
  'assets/app/logo-display-512.webp',
]);

function contentVersion(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

function versionedIndex(publicDir) {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const versions = new Map();
  // Altera apenas URLs locais de recursos explicitamente permitidos.
  // Não altera scripts externos, endpoints, links das salas ou URLs dinâmicas.
  return html.replace(/(\b(?:src|href)=")((?:\/?[a-zA-Z0-9_./-]+)\.(?:css|js|png|webp|webmanifest))(?:\?[^"\s]*)?("|(?=\s))/g,
    (full, beginning, url, ending) => {
      const rel = url.startsWith('/') ? url.slice(1) : url;
      if (!VERSIONED_FILES.has(rel)) return full;
      let version = versions.get(rel);
      if (!version) {
        version = contentVersion(fs.readFileSync(path.join(publicDir, rel)));
        versions.set(rel, version);
      }
      return `${beginning}${url}?v=${version}${ending}`;
    });
}

module.exports = { contentVersion, versionedIndex };
