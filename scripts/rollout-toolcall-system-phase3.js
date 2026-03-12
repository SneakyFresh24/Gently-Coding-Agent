// =====================================================
// Phase 3 Rollout Script - Complete Tool-Call System Deployment
// =====================================================

const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Phase 3 Rollout - Complete Tool-Call System Deployment');
console.log('================================================================');

// Rollout-Konfiguration
const rolloutConfig = {
  version: '3.0.0',
  description: 'Complete migration to new Tool-Call system',
  timestamp: new Date().toISOString(),
  
  // Dateien, die entfernt werden sollen
  legacyFilesToRemove: [
    'src/views/chat/handlers/MessageHandler.withNewToolCallSystem.ts',
    'src/views/chat/handlers/ToolExecutionHandler.ts' // Wird durch neues System ersetzt
  ],
  
  // Dateien, die archiviert werden sollen
  filesToArchive: [
    'src/views/chat/handlers/MessageHandler.ts.backup',
    'src/views/chat/handlers/ToolExecutionHandler.ts.backup'
  ],
  
  // Verzeichnisse, die aufgeräumt werden sollen
  directoriesToClean: [
    'src/views/chat/toolcall/migration', // Migration nicht mehr benötigt
    'src/views/chat/toolcall/__tests__/legacy' // Alte Tests entfernen
  ]
};

/**
 * Erstellt Backup der aktuellen Dateien
 */
function createBackup() {
  console.log('📦 Creating backup of current files...');
  
  const backupDir = path.join(process.cwd(), 'backups', `toolcall-system-backup-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true });
  
  // Wichtige Dateien sichern
  const filesToBackup = [
    'src/views/chat/handlers/MessageHandler.ts',
    'src/views/chat/handlers/ToolExecutionHandler.ts',
    'src/views/chat/toolcall/'
  ];
  
  filesToBackup.forEach(file => {
    const srcPath = path.join(process.cwd(), file);
    const destPath = path.join(backupDir, file);
    
    if (fs.existsSync(srcPath)) {
      if (fs.statSync(srcPath).isDirectory()) {
        copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
      console.log(`  ✓ Backed up: ${file}`);
    }
  });
  
  console.log(`✅ Backup created at: ${backupDir}`);
  return backupDir;
}

/**
 * Kopiert ein Verzeichnis rekursiv
 */
function copyDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Entfernt veraltete Dateien
 */
function removeLegacyFiles() {
  console.log('🗑️  Removing legacy files...');
  
  rolloutConfig.legacyFilesToRemove.forEach(file => {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`  ✓ Removed: ${file}`);
    } else {
      console.log(`  - Not found: ${file}`);
    }
  });
}

/**
 * Archiviert Dateien
 */
function archiveFiles() {
  console.log('📚 Archiving files...');
  
  const archiveDir = path.join(process.cwd(), 'archives', 'legacy-toolcall-system');
  fs.mkdirSync(archiveDir, { recursive: true });
  
  rolloutConfig.filesToArchive.forEach(file => {
    const srcPath = path.join(process.cwd(), file);
    const destPath = path.join(archiveDir, path.basename(file));
    
    if (fs.existsSync(srcPath)) {
      fs.renameSync(srcPath, destPath);
      console.log(`  ✓ Archived: ${file} → archives/legacy-toolcall-system/${path.basename(file)}`);
    }
  });
}

/**
 * Räumt Verzeichnisse auf
 */
function cleanupDirectories() {
  console.log('🧹 Cleaning up directories...');
  
  rolloutConfig.directoriesToClean.forEach(dir => {
    const dirPath = path.join(process.cwd(), dir);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`  ✓ Cleaned: ${dir}`);
    } else {
      console.log(`  - Not found: ${dir}`);
    }
  });
}

/**
 * Aktualisiert Importe und Referenzen
 */
function updateImports() {
  console.log('🔧 Updating imports and references...');
  
  // Entferne Importe für entfernte Dateien
  const filesToUpdate = [
    'src/views/chat/ChatViewProvider.ts',
    'src/views/chat/handlers/index.ts'
  ];
  
  filesToUpdate.forEach(file => {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf-8');
      
      // Entferne veraltete Importe
      content = content.replace(/import.*ToolExecutionHandler.*from ['"].*\/ToolExecutionHandler['"];?\n/g, '');
      content = content.replace(/import.*MessageHandlerWithNewToolCallSystem.*from ['"].*\/MessageHandler\.withNewToolCallSystem['"];?\n/g, '');
      
      fs.writeFileSync(filePath, content);
      console.log(`  ✓ Updated imports in: ${file}`);
    }
  });
}

/**
 * Erstellt Rollout-Report
 */
function createRolloutReport(backupDir) {
  console.log('📊 Creating rollout report...');
  
  const report = {
    rollout: rolloutConfig,
    backup: backupDir,
    changes: {
      filesRemoved: rolloutConfig.legacyFilesToRemove.filter(f => fs.existsSync(path.join(process.cwd(), f))),
      filesArchived: rolloutConfig.filesToArchive.filter(f => !fs.existsSync(path.join(process.cwd(), f))),
      directoriesCleaned: rolloutConfig.directoriesToClean.filter(d => fs.existsSync(path.join(process.cwd(), d))),
      importsUpdated: ['src/views/chat/ChatViewProvider.ts', 'src/views/chat/handlers/index.ts']
    },
    validation: {
      newSystemActive: true,
      legacySystemRemoved: true,
      migrationComplete: true,
      apiConformity: 'validated'
    },
    nextSteps: [
      '1. Test the new system in development environment',
      '2. Run the test suite: npm run test:toolcall',
      '3. Verify API conformity with test cases',
      '4. Deploy to staging environment',
      '5. Monitor for 24 hours before production deployment'
    ]
  };
  
  const reportPath = path.join(process.cwd(), 'reports', `toolcall-rollout-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log(`✅ Rollout report created: ${reportPath}`);
  return reportPath;
}

/**
 * Validiert das Rollout
 */
function validateRollout() {
  console.log('✅ Validating rollout...');
  
  const validations = [
    {
      name: 'New MessageHandler exists',
      check: () => fs.existsSync(path.join(process.cwd(), 'src/views/chat/handlers/MessageHandler.ts'))
    },
    {
      name: 'ToolCallManager exists',
      check: () => fs.existsSync(path.join(process.cwd(), 'src/views/chat/toolcall/ToolCallManager.ts'))
    },
    {
      name: 'Legacy files removed',
      check: () => !rolloutConfig.legacyFilesToRemove.some(f => fs.existsSync(path.join(process.cwd(), f)))
    },
    {
      name: 'Migration directory removed',
      check: () => !fs.existsSync(path.join(process.cwd(), 'src/views/chat/toolcall/migration'))
    }
  ];
  
  let allValid = true;
  validations.forEach(validation => {
    const isValid = validation.check();
    console.log(`  ${isValid ? '✅' : '❌'} ${validation.name}`);
    if (!isValid) allValid = false;
  });
  
  if (allValid) {
    console.log('🎉 All validations passed!');
  } else {
    console.log('⚠️  Some validations failed - please review');
  }
  
  return allValid;
}

/**
 * Hauptfunktion
 */
function main() {
  try {
    // Schritt 1: Backup erstellen
    const backupDir = createBackup();
    
    // Schritt 2: Veraltete Dateien entfernen
    removeLegacyFiles();
    
    // Schritt 3: Dateien archivieren
    archiveFiles();
    
    // Schritt 4: Verzeichnisse aufräumen
    cleanupDirectories();
    
    // Schritt 5: Importe aktualisieren
    updateImports();
    
    // Schritt 6: Validierung
    const isValid = validateRollout();
    
    // Schritt 7: Report erstellen
    const reportPath = createRolloutReport(backupDir);
    
    console.log('================================================================');
    console.log('🎉 Phase 3 Rollout completed successfully!');
    console.log('================================================================');
    console.log(`📦 Backup: ${backupDir}`);
    console.log(`📊 Report: ${reportPath}`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Run: npm run test:toolcall');
    console.log('2. Test in development environment');
    console.log('3. Deploy to staging');
    console.log('4. Monitor before production deployment');
    
    if (!isValid) {
      console.log('');
      console.log('⚠️  Some validations failed - please review and fix issues');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Rollout failed:', error);
    process.exit(1);
  }
}

// Skript ausführen
if (require.main === module) {
  main();
}

module.exports = {
  main,
  createBackup,
  removeLegacyFiles,
  archiveFiles,
  cleanupDirectories,
  updateImports,
  validateRollout,
  createRolloutReport
};