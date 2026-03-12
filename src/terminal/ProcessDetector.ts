import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Process Detector
 * Detects running processes and ports
 */
export class ProcessDetector {
  /**
   * Check if a port is in use
   */
  static async isPortInUse(port: number): Promise<boolean> {
    try {
      const platform = process.platform;

      if (platform === 'win32') {
        // Windows: netstat -ano | findstr :PORT
        const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
        return stdout.trim().length > 0;
      } else {
        // Linux/Mac: lsof -i :PORT
        try {
          const { stdout } = await execAsync(`lsof -i :${port}`);
          return stdout.trim().length > 0;
        } catch {
          // lsof returns non-zero exit code if port is not in use
          return false;
        }
      }
    } catch (error) {
      // If command fails, assume port is not in use
      return false;
    }
  }

  /**
   * Check if common dev server ports are in use
   */
  static async checkDevServerPorts(): Promise<{ port: number; inUse: boolean }[]> {
    const commonPorts = [1420, 3000, 3001, 3002, 4173, 4200, 4321, 5000, 5173, 5174, 6006, 8000, 8080, 8081, 8787, 9000, 24678];

    const results = await Promise.all(
      commonPorts.map(async (port) => ({
        port,
        inUse: await this.isPortInUse(port)
      }))
    );

    return results;
  }

  /**
   * Get process info for a port (Windows)
   */
  static async getProcessOnPortWindows(port: number): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.trim().split('\n');

      if (lines.length === 0) return null;

      // Extract PID from first line
      const match = lines[0].match(/\s+(\d+)\s*$/);
      if (!match) return null;

      const pid = match[1];

      // Get process name
      try {
        const { stdout: tasklistOutput } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
        const processName = tasklistOutput.split(',')[0].replace(/"/g, '');
        return `${processName} (PID: ${pid})`;
      } catch {
        return `PID: ${pid}`;
      }
    } catch {
      return null;
    }
  }

  /**
   * Get process info for a port (Linux/Mac)
   */
  static async getProcessOnPortUnix(port: number): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`lsof -i :${port} -t`);
      const pid = stdout.trim();

      if (!pid) return null;

      // Get process name
      try {
        const { stdout: psOutput } = await execAsync(`ps -p ${pid} -o comm=`);
        const processName = psOutput.trim();
        return `${processName} (PID: ${pid})`;
      } catch {
        return `PID: ${pid}`;
      }
    } catch {
      return null;
    }
  }

  /**
   * Get process info for a port
   */
  static async getProcessOnPort(port: number): Promise<string | null> {
    const platform = process.platform;

    if (platform === 'win32') {
      return await this.getProcessOnPortWindows(port);
    } else {
      return await this.getProcessOnPortUnix(port);
    }
  }

  /**
   * Check if a dev server is likely running
   */
  static async isDevServerRunning(): Promise<{ running: boolean; port?: number; process?: string }> {
    const portResults = await this.checkDevServerPorts();
    const inUsePorts = portResults.filter(r => r.inUse);

    if (inUsePorts.length === 0) {
      return { running: false };
    }

    // Get process info for first in-use port
    const firstPort = inUsePorts[0].port;
    const processInfo = await this.getProcessOnPort(firstPort);

    return {
      running: true,
      port: firstPort,
      process: processInfo || undefined
    };
  }
}

