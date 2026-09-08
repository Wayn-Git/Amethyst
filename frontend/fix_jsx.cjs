const fs = require('fs');

let f = '/home/wayne/Documents/GitHub/amethyst/frontend/src/views/library/AddContentModal.jsx';
let content = fs.readFileSync(f, 'utf8');
content = content.replace(/<\/motion\.div>\n      <\/motion\.div>\n    <\/motion\.div>\n      \)}\n    <\/AnimatePresence>\n  \)\n}/,
"        </div>\n      </motion.div>\n    </motion.div>\n      )}\n    </AnimatePresence>\n  )\n}");
fs.writeFileSync(f, content);

f = '/home/wayne/Documents/GitHub/amethyst/frontend/src/views/library/SharePanels.jsx';
content = fs.readFileSync(f, 'utf8');
content = content.replace(/<\/motion\.div>\n    <\/motion\.div>\n      \)}\n    <\/AnimatePresence>\n  \)\n}/,
"        </div>\n      </motion.div>\n    </motion.div>\n      )}\n    </AnimatePresence>\n  )\n}");
fs.writeFileSync(f, content);

