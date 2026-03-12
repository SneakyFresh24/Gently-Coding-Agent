// =====================================================
// Docker Plugin
// =====================================================

import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

import { Plugin, PluginContext, Command, Tool } from '../types/PluginTypes';

const execAsync = promisify(exec);

/**
 * Docker-Integration-Plugin
 */
export class DockerPlugin implements Plugin {
  id = 'docker';
  name = 'Docker Integration';
  version = '1.0.0';
  description = 'Provides Docker commands and tools for the VS Code Agent';
  author = 'VS Code Agent Team';
  
  private context?: PluginContext;
  
  activate(context: PluginContext): void {
    this.context = context;
    
    // Registriere Commands
    this.registerCommands();
    
    // Registriere Tools
    this.registerTools();
    
    // Zeige Benachrichtigung
    context.showInformationMessage('Docker Plugin activated');
  }
  
  deactivate(): void {
    // Aufräumarbeiten
    this.context = undefined;
  }
  
  private registerCommands(): void {
    if (!this.context) return;
    
    // Docker List Containers Command
    this.context.registerCommand({
      id: 'listContainers',
      title: 'Docker: List Containers',
      category: 'Docker',
      handler: async () => {
        const containers = await this.listContainers();
        const message = `Found ${containers.length} containers`;
        this.context?.showInformationMessage(message);
      }
    });
    
    // Docker List Images Command
    this.context.registerCommand({
      id: 'listImages',
      title: 'Docker: List Images',
      category: 'Docker',
      handler: async () => {
        const images = await this.listImages();
        const message = `Found ${images.length} images`;
        this.context?.showInformationMessage(message);
      }
    });
    
    // Docker Build Image Command
    this.context.registerCommand({
      id: 'buildImage',
      title: 'Docker: Build Image',
      category: 'Docker',
      handler: async () => {
        const dockerfile = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Select Dockerfile',
          filters: {
            'Dockerfile': ['Dockerfile', 'dockerfile']
          }
        });
        
        if (dockerfile && dockerfile[0]) {
          const imageName = await vscode.window.showInputBox({
            prompt: 'Enter image name',
            placeHolder: 'my-app:latest'
          });
          
          if (imageName) {
            const dockerfilePath = path.dirname(dockerfile[0].fsPath);
            await this.buildImage(imageName, dockerfilePath);
            this.context?.showInformationMessage(`Built image: ${imageName}`);
          }
        }
      }
    });
  }
  
  private registerTools(): void {
    if (!this.context) return;
    
    // Docker List Containers Tool
    this.context.registerTool({
      id: 'listContainers',
      name: 'docker_list_containers',
      description: 'List all Docker containers',
      parameters: [
        {
          name: 'all',
          type: 'boolean',
          description: 'Include stopped containers',
          required: false,
          defaultValue: false
        }
      ],
      handler: async (params) => {
        const { all = false } = params;
        const containers = await this.listContainers(all);
        return { containers };
      }
    });
    
    // Docker List Images Tool
    this.context.registerTool({
      id: 'listImages',
      name: 'docker_list_images',
      description: 'List all Docker images',
      parameters: [],
      handler: async () => {
        const images = await this.listImages();
        return { images };
      }
    });
    
    // Docker Build Image Tool
    this.context.registerTool({
      id: 'buildImage',
      name: 'docker_build_image',
      description: 'Build a Docker image',
      parameters: [
        {
          name: 'imageName',
          type: 'string',
          description: 'Name of the image to build',
          required: true
        },
        {
          name: 'dockerfilePath',
          type: 'string',
          description: 'Path to the directory containing the Dockerfile',
          required: true
        },
        {
          name: 'dockerfile',
          type: 'string',
          description: 'Name of the Dockerfile',
          required: false,
          defaultValue: 'Dockerfile'
        }
      ],
      handler: async (params) => {
        const { imageName, dockerfilePath, dockerfile = 'Dockerfile' } = params;
        await this.buildImage(imageName, dockerfilePath, dockerfile);
        return {
          imageName,
          timestamp: new Date().toISOString()
        };
      }
    });
    
    // Docker Run Container Tool
    this.context.registerTool({
      id: 'runContainer',
      name: 'docker_run_container',
      description: 'Run a Docker container',
      parameters: [
        {
          name: 'imageName',
          type: 'string',
          description: 'Name of the image to run',
          required: true
        },
        {
          name: 'containerName',
          type: 'string',
          description: 'Name for the container',
          required: false
        },
        {
          name: 'ports',
          type: 'array',
          description: 'Port mappings (e.g., ["8080:80"])',
          required: false
        },
        {
          name: 'environment',
          type: 'object',
          description: 'Environment variables',
          required: false
        },
        {
          name: 'detach',
          type: 'boolean',
          description: 'Run container in detached mode',
          required: false,
          defaultValue: true
        }
      ],
      handler: async (params) => {
        const { imageName, containerName, ports, environment, detach = true } = params;
        const containerId = await this.runContainer({
          imageName,
          containerName,
          ports,
          environment,
          detach
        });
        return {
          containerId,
          imageName,
          timestamp: new Date().toISOString()
        };
      }
    });
    
    // Docker Stop Container Tool
    this.context.registerTool({
      id: 'stopContainer',
      name: 'docker_stop_container',
      description: 'Stop a running container',
      parameters: [
        {
          name: 'containerId',
          type: 'string',
          description: 'ID or name of the container to stop',
          required: true
        }
      ],
      handler: async (params) => {
        const { containerId } = params;
        await this.stopContainer(containerId);
        return {
          containerId,
          timestamp: new Date().toISOString()
        };
      }
    });
  }
  
  private async listContainers(all: boolean = false): Promise<any[]> {
    try {
      const { stdout } = await execAsync(`docker ps ${all ? '-a' : ''} --format "{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}"`);
      const lines = stdout.trim().split('\n');
      
      return lines.map(line => {
        const [id, image, status, names] = line.split('|');
        return {
          id,
          image,
          status,
          names
        };
      });
    } catch (error) {
      throw new Error(`Error listing containers: ${(error as Error).message}`);
    }
  }
  
  private async listImages(): Promise<any[]> {
    try {
      const { stdout } = await execAsync('docker images --format "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}"');
      const lines = stdout.trim().split('\n');
      
      return lines.map(line => {
        const [id, repository, tag, size] = line.split('|');
        return {
          id,
          repository,
          tag,
          size
        };
      });
    } catch (error) {
      throw new Error(`Error listing images: ${(error as Error).message}`);
    }
  }
  
  private async buildImage(imageName: string, dockerfilePath: string, dockerfile: string = 'Dockerfile'): Promise<void> {
    try {
      await execAsync(`docker build -t ${imageName} -f ${dockerfile} ${dockerfilePath}`);
    } catch (error) {
      throw new Error(`Error building image: ${(error as Error).message}`);
    }
  }
  
  private async runContainer(options: {
    imageName: string;
    containerName?: string;
    ports?: string[];
    environment?: Record<string, string>;
    detach?: boolean;
  }): Promise<string> {
    try {
      let command = `docker run ${options.detach ? '-d' : ''}`;
      
      if (options.containerName) {
        command += ` --name ${options.containerName}`;
      }
      
      if (options.ports && options.ports.length > 0) {
        for (const port of options.ports) {
          command += ` -p ${port}`;
        }
      }
      
      if (options.environment) {
        for (const [key, value] of Object.entries(options.environment)) {
          command += ` -e ${key}="${value}"`;
        }
      }
      
      command += ` ${options.imageName}`;
      
      const { stdout } = await execAsync(command);
      return stdout.trim();
    } catch (error) {
      throw new Error(`Error running container: ${(error as Error).message}`);
    }
  }
  
  private async stopContainer(containerId: string): Promise<void> {
    try {
      await execAsync(`docker stop ${containerId}`);
    } catch (error) {
      throw new Error(`Error stopping container: ${(error as Error).message}`);
    }
  }
}