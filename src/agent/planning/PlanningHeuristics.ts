export class PlanningHeuristics {
    static shouldUseIterativePlanning(goal: string): boolean {
        const keywords = [
            'refactor', 'implement', 'create', 'build', 'develop', 'design',
            'system', 'application', 'feature', 'component', 'module',
            'multiple', 'several', 'complex', 'complete', 'entire'
        ];
        const lower = goal.toLowerCase();
        return keywords.some(k => lower.includes(k));
    }
}
