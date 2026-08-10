const React = window.React;

// The public, read-only API reference: /apis/:workspace/:folder.
//
// A published API reference is its own thing with its own link — it is not a
// section of the docs site, and a /docs/ URL will not serve it (the server
// checks the folder's `kind` and 404s a mismatch, see routes/public.js).
//
// The reading surface itself is shared with the docs site rather than copied:
// an endpoint page and a text page render identically on both, so the only
// difference is which collection each resolves and which URL its share links
// point at. See PublicDocsView.jsx for the implementation.
window.PublicApiView = ({ wsPath, folderName }) => (
    <window.PublicCollectionView wsPath={wsPath} folderName={folderName} kind="API" />
);
