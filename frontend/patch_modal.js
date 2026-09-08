const fs = require('fs');
const file = '/home/wayne/Documents/GitHub/amethyst/frontend/src/views/library/AddContentModal.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "import Icon from '../../components/Icon.jsx'",
  "import Icon from '../../components/Icon.jsx'\nimport { motion, AnimatePresence } from 'framer-motion'"
);

content = content.replace(
  "  if (!open) return null\n\n  return (\n    <div\n      className=\"modal-overlay\"\n      onMouseDown={onOverlayMouseDown(panelRef, onClose)}\n      role=\"dialog\"\n      aria-modal=\"true\"\n    >\n      <div className=\"modal add-content-modal\" ref={panelRef}>",
  `  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay"
          onMouseDown={onOverlayMouseDown(panelRef, onClose)}
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div 
            className="modal add-content-modal" 
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >`
);

content = content.replace(
  "        </div>\n      </div>\n    </div>\n  )\n}",
  "        </div>\n      </motion.div>\n    </motion.div>\n      )}\n    </AnimatePresence>\n  )\n}"
);

fs.writeFileSync(file, content);
