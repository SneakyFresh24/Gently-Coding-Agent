/**
 * Simple Dependency Injection Container
 */
export class Container {
    private factories: Map<string, (c: Container) => any> = new Map();
    private instances: Map<string, any> = new Map();

    /**
     * Register a service factory
     */
    register<T>(name: string, factory: (c: Container) => T): void {
        this.factories.set(name, factory);
    }

    /**
     * Resolve a service instance (singleton)
     */
    resolve<T>(name: string): T {
        if (this.instances.has(name)) {
            return this.instances.get(name);
        }

        const factory = this.factories.get(name);
        if (!factory) {
            throw new Error(`Service not registered: ${name}`);
        }

        const instance = factory(this);
        this.instances.set(name, instance);
        return instance;
    }

    /**
     * Force a specific instance (useful for external dependencies like ExtensionContext)
     */
    force<T>(name: string, instance: T): void {
        this.instances.set(name, instance);
    }

    /**
     * Clear all instances (useful for testing or reset)
     */
    clear(): void {
        this.instances.clear();
    }
}
