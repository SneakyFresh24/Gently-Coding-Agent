import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import { ShellIntegrationExecutor } from '../ShellIntegrationExecutor';
import { ExecutionOptions, OutputChunk } from './types/ExecutionTypes';

describe('ShellIntegrationExecutor', () => {
    let executor: ShellIntegrationExecutor;
    let webviewCommunicator: any;
    let cp: any;

    beforeEach(() => {
        webviewCommunicator = {
            sendFallbackModeUsed: sinon.stub()
        };
        executor = new ShellIntegrationExecutor(webviewCommunicator);
        // Mock child_process
        cp = require('child_process');
    });

    afterEach(() => {
        sinon.restore();
        executor.dispose();
    });

    it('should be initialized correctly', () => {
        assert.ok(executor);
    });

    it('should detect long running commands', () => {
        const isLongRunning = (executor as any).isLongRunningCommand.bind(executor);

        assert.strictEqual(isLongRunning('npm run dev'), true);
        assert.strictEqual(isLongRunning('npm start'), true);
        assert.strictEqual(isLongRunning('cargo run'), true);
        assert.strictEqual(isLongRunning('ls -la'), false);
        assert.strictEqual(isLongRunning('git status'), false);
    });

    it('should detect shell type correctly', async () => {
        const getShellType = (executor as any).getTerminalShellType.bind(executor);

        const mockTerminalGitBash = {
            creationOptions: {
                shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe'
            }
        } as any;

        const mockTerminalPwsh = {
            creationOptions: {
                shellPath: 'pwsh.exe'
            }
        } as any;

        assert.strictEqual(await getShellType(mockTerminalGitBash), 'Git Bash');
        assert.strictEqual(await getShellType(mockTerminalPwsh), 'PowerShell');
    });

    describe('Integration: executeLegacyMethod', () => {
        it('should spawn a process, stream output, and handle exit', async () => {
            const mockProcess = new EventEmitter() as any;
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = sinon.stub();

            const spawnStub = sinon.stub(cp, 'spawn').returns(mockProcess);

            const mockTerminal = {
                sendText: sinon.stub(),
                creationOptions: {}
            } as any;

            const onChunk = sinon.stub();
            const commandId = 'test-cmd-123';
            const command = 'echo "hello worlds"';

            // Execute the private legacy method
            const executionPromise = (executor as any).executeLegacyMethod(
                commandId,
                command,
                mockTerminal,
                {},
                onChunk,
                Date.now()
            );

            // Simulate output
            mockProcess.stdout.emit('data', Buffer.from('hello'));
            mockProcess.stdout.emit('data', Buffer.from(' '));
            mockProcess.stdout.emit('data', Buffer.from('worlds\n'));

            // Simulate exit
            mockProcess.emit('close', 0);

            const result = await executionPromise;

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.success, true);
            assert.ok(result.output.includes('hello worlds'));

            // Verify chunks were called
            assert.ok(onChunk.called);
            const chunks = onChunk.getCalls().map(c => c.args[0] as OutputChunk);
            assert.ok(chunks.some(c => c.data === 'hello'));
            assert.ok(chunks.some(c => c.data === 'worlds\n'));
        });

        it('should handle process errors and kill command', async () => {
            const mockProcess = new EventEmitter() as any;
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = sinon.stub();

            const spawnStub = sinon.stub(cp, 'spawn').returns(mockProcess);

            const mockTerminal = {
                sendText: sinon.stub(),
                creationOptions: {}
            } as any;

            const onChunk = sinon.stub();
            const commandId = 'test-kill-123';

            const executionPromise = (executor as any).executeLegacyMethod(
                commandId,
                'long-command',
                mockTerminal,
                {},
                onChunk,
                Date.now()
            );

            // Verify command is running
            (executor as any).activeExecutions.set(commandId, { dispose: () => mockProcess.kill() });

            // Kill the command
            executor.killCommand(commandId);
            assert.ok(mockProcess.kill.called);

            // Simulate exit after kill
            mockProcess.emit('close', 1);

            const result = await executionPromise;
            assert.strictEqual(result.exitCode, 1);
            assert.strictEqual(result.success, false);
        });

        it('should handle stderr output', async () => {
            const mockProcess = new EventEmitter() as any;
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = sinon.stub();

            sinon.stub(cp, 'spawn').returns(mockProcess);

            const mockTerminal = { sendText: sinon.stub(), creationOptions: {} } as any;
            const onChunk = sinon.stub();

            const executionPromise = (executor as any).executeLegacyMethod(
                'err-cmd', 'cmd', mockTerminal, {}, onChunk, Date.now()
            );

            mockProcess.stderr.emit('data', Buffer.from('error occurred'));
            mockProcess.emit('close', 1);

            const result = await executionPromise;
            assert.strictEqual(result.exitCode, 1);
            assert.ok(result.output.includes('error occurred'));
            assert.ok(onChunk.calledWith(sinon.match({ type: 'stderr', data: 'error occurred' })));
        });
    });
});
