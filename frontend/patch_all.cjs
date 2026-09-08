const fs = require('fs');

// Patch LibraryDetailModal.jsx
let detailPath = '/home/wayne/Documents/GitHub/pkos/frontend/src/views/library/LibraryDetailModal.jsx';
let detail = fs.readFileSync(detailPath, 'utf8');
detail = detail.replace(
  "import Icon from '../../components/Icon.jsx'",
  "import Icon from '../../components/Icon.jsx'\nimport { motion } from 'framer-motion'"
);
detail = detail.replace(
  "  return (\n    <div\n      className=\"modal-overlay\"",
  "  return (\n    <motion.div\n      initial={{ opacity: 0 }}\n      animate={{ opacity: 1 }}\n      exit={{ opacity: 0 }}\n      transition={{ duration: 0.15 }}\n      className=\"modal-overlay\""
);
detail = detail.replace(
  "    >\n      <div className=\"modal lib-detail-modal\"",
  "    >\n      <motion.div\n        initial={{ opacity: 0, scale: 0.96, y: 8 }}\n        animate={{ opacity: 1, scale: 1, y: 0 }}\n        exit={{ opacity: 0, scale: 0.96, y: 8 }}\n        transition={{ duration: 0.2, ease: \"easeOut\" }}\n        className=\"modal lib-detail-modal\""
);
detail = detail.replace(
  "      </div>\n    </div>\n  )\n}",
  "      </motion.div>\n    </motion.div>\n  )\n}"
);
fs.writeFileSync(detailPath, detail);

// Patch SharePanels.jsx
let sharePath = '/home/wayne/Documents/GitHub/pkos/frontend/src/views/library/SharePanels.jsx';
let share = fs.readFileSync(sharePath, 'utf8');
share = share.replace(
  "import Icon from '../../components/Icon.jsx'",
  "import Icon from '../../components/Icon.jsx'\nimport { motion, AnimatePresence } from 'framer-motion'"
);
share = share.replace(
  "  if (!open) return null\n\n  return (\n    <div\n      className=\"modal-overlay\"",
  "  return (\n    <AnimatePresence>\n      {open && (\n    <motion.div\n      initial={{ opacity: 0 }}\n      animate={{ opacity: 1 }}\n      exit={{ opacity: 0 }}\n      transition={{ duration: 0.15 }}\n      className=\"modal-overlay\""
);
share = share.replace(
  "    >\n      <div className=\"modal share-modal\"",
  "    >\n      <motion.div\n        initial={{ opacity: 0, scale: 0.96, y: 8 }}\n        animate={{ opacity: 1, scale: 1, y: 0 }}\n        exit={{ opacity: 0, scale: 0.96, y: 8 }}\n        transition={{ duration: 0.2, ease: \"easeOut\" }}\n        className=\"modal share-modal\""
);
share = share.replace(
  "      </div>\n    </div>\n  )\n}",
  "      </motion.div>\n    </motion.div>\n      )}\n    </AnimatePresence>\n  )\n}"
);
fs.writeFileSync(sharePath, share);

// Patch LibraryTagRail.jsx
let railPath = '/home/wayne/Documents/GitHub/pkos/frontend/src/views/library/LibraryTagRail.jsx';
let rail = fs.readFileSync(railPath, 'utf8');
rail = rail.replace(
  "import Icon from '../../components/Icon.jsx'",
  "import Icon from '../../components/Icon.jsx'\nimport { motion } from 'framer-motion'"
);
rail = rail.replace(
  "  return (\n    <aside\n      ref={railRef}\n      className=\"lib-tag-rail\"",
  "  return (\n    <motion.aside\n      initial={{ opacity: 0, x: -20 }}\n      animate={{ opacity: 1, x: 0 }}\n      exit={{ opacity: 0, x: -20 }}\n      transition={{ duration: 0.25, ease: \"easeOut\" }}\n      ref={railRef}\n      className=\"lib-tag-rail\""
);
rail = rail.replace(
  "      </div>\n    </aside>\n  )\n}",
  "      </div>\n    </motion.aside>\n  )\n}"
);
fs.writeFileSync(railPath, rail);

