// =====================================================
// Cleanup Script - Remove Legacy Files
// =====================================================

const fs = require('fs');
const path = require('path');

console.log('🧹 Cleaning up legacy files...');

// Dateien, die gelöscht werden sollen
const filesToDelete = [
  'src/views/chat/handlers/MessageHandler.withNewToolCallSystem.ts',
  'src/views/chat/handlers/ToolExecutionHandler.ts.backup',
  'src/views/chat/handlers/MessageHandler.ts.backup'
];

// Verzeichnisse, die gelöscht werden sollen
const dirsToDelete = [
  'src/views/chat/toolcall/migration',
  'src/views/chat/toolcall/__tests__/legacy'
];

let deletedCount = 0;

// Dateien löschen
console.log('\n📄 Deleting files...');
filesToDelete.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`  ✅ Deleted: ${file}`);
      deletedCount++;
    } else {
      console.log(`  - Not found: ${file}`);
    }
  } catch (error) {
    console.error(`  ❌ Error deleting ${file}:`, error.message);
  }
});

// Verzeichnisse löschen
console.log('\n📁 Deleting directories...');
dirsToDelete.forEach(dir => {
  const dirPath = path.join(process.cwd(), dir);
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`  ✅ Deleted: ${dir}`);
      deletedCount++;
    } else {
      console.log(`  - Not found: ${dir}`);
    }
  } catch (error) {
    console.error(`  ❌ Error deleting ${dir}:`, error.message);
  }
});

console.log(`\n🎉 Cleanup completed! Deleted ${deletedCount} items.`);

// Überprüfen, ob das System sauber ist
console.log('\n🔍 Verifying cleanup...');
const remainingLegacyFiles = filesToDelete.filter(file => 
  fs.existsSync(path.join(process.cwd(), file))
);

const remainingLegacyDirs = dirsToDelete.filter(dir => 
  fs.existsSync(path.join(process.cwd(), dir))
);

if (remainingLegacyFiles.length === 0 && remainingLegacyDirs.length === 0) {
  console.log('✅ All legacy files removed successfully!');
} else {
  console.log('⚠️  Some items could not be removed:');
  remainingLegacyFiles.forEach(file => console.log(`  - ${file}`));
  remainingLegacyDirs.forEach(dir => console.log(`  - ${dir}`));
}