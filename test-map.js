"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const CodebaseMapGenerator_1 = require("./src/agent/CodebaseMapGenerator");
const fileOperations_1 = require("./src/agent/fileOperations");
async function test() {
    const fileOps = new fileOperations_1.FileOperations();
    const generator = new CodebaseMapGenerator_1.CodebaseMapGenerator(fileOps);
    const map = await generator.generateMap('./src/agent');
    console.log(map);
}
test().catch(console.error);
//# sourceMappingURL=test-map.js.map