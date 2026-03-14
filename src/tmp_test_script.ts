import { EditorEngine, MultiHunkEditRequest } from './agent/editors/EditorEngine';
import { FileOperations } from './agent/fileOperations';
import { ASTAnalyzer } from './agent/ASTAnalyzer';
import * as vscode from 'vscode';

async function runTest() {
  console.log("Starting EditorEngine Block Edit Test");
  
  // Mock dependencies
  class MockFileOps extends FileOperations {
    getWorkspaceRoot() {
      return "C:/Users/Bekim Lika/Desktop/Agent/src";
    }
  }
  
  const mockFileOps = new MockFileOps();
  const mockAstAnalyzer = new ASTAnalyzer({} as any, mockFileOps);
  
  const engine = new EditorEngine(mockFileOps, mockAstAnalyzer);

  const request: MultiHunkEditRequest = {
    filePath: "tmp_test_file.ts",
    mode: "best-effort",
    previewOnly: false,
    edits: [
      {
        id: "hunk-1",
        oldContent: "  console.log(\"Hello A\");",
        newContent: "  console.log(\"Modified A\");",
        reason: "Test A"
      },
      {
        id: "hunk-3",
        oldContent: "  console.log(\"Hello C\");",
        newContent: "  console.log(\"Modified C\");",
        reason: "Test C"
      },
      {
        id: "fail-hunk",
        oldContent: "  console.log(\"Hello Z\");",
        newContent: "  console.log(\"Modified Z\");",
        reason: "Intentionally failing hunk"
      }
    ]
  };

  const result = await engine.applyHunkEditsSafely(request);
  
  console.log("Result success:", result.success);
  console.log("Applied Count:", result.appliedCount);
  console.log("Failed Count:", result.failedCount);
  console.log("Applied Hunks:", result.appliedHunks);
  console.log("Failed Hunks:", result.failedHunks);
  
}

runTest().catch(console.error);
