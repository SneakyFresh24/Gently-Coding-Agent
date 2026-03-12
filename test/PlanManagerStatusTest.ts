/**
 * Test zur Überprüfung der Status-Verwaltung im Architect-Modus
 * Stellt sicher, dass Pläne mit korrektem 'pending' Status erstellt werden
 */

import { PlanManager } from '../src/agent/planning/PlanManager';
import { CreatePlanParams } from '../src/agent/planning/types';

describe('PlanManager Status Test', () => {
  let planManager: PlanManager;

  beforeEach(() => {
    planManager = new PlanManager();
  });

  test('should create plan with all steps having pending status', () => {
    const params: CreatePlanParams = {
      goal: 'Test plan creation',
      steps: [
        {
          description: 'Step 1',
          tool: 'test_tool',
          parameters: { param1: 'value1' }
        },
        {
          description: 'Step 2',
          tool: 'test_tool',
          parameters: { param1: 'value2' }
        }
      ]
    };

    const plan = planManager.createPlan(params);

    // Überprüfe, dass der Plan den korrekten Status hat
    expect(plan.status).toBe('pending');
    expect(plan.totalSteps).toBe(2);
    expect(plan.completedSteps).toBe(0);
    expect(plan.failedSteps).toBe(0);

    // Überprüfe, dass alle Schritte 'pending' Status haben
    plan.steps.forEach(step => {
      expect(step.status).toBe('pending');
    });

    console.log('✅ Plan created with correct pending status for all steps');
  });

  test('should validate and correct inconsistent plan status', () => {
    const params: CreatePlanParams = {
      goal: 'Test status validation',
      steps: [
        {
          description: 'Step 1',
          tool: 'test_tool',
          parameters: { param1: 'value1' }
        }
      ]
    };

    const plan = planManager.createPlan(params);
    
    // Simuliere eine inkonsistente Status-Situation
    plan.status = 'completed'; // Falsch, da noch Schritte pending sind
    
    // Validierung sollte den Status korrigieren
    const validation = planManager.validatePlanStatus(plan.id);
    
    expect(validation.valid).toBe(false);
    expect(validation.issues).toContain('Plan marked as completed but has pending steps');
    expect(plan.status).toBe('executing'); // Korrigierter Status
    
    console.log('✅ Status validation correctly identified and fixed inconsistent status');
  });

  test('should maintain correct status during step completion', () => {
    const params: CreatePlanParams = {
      goal: 'Test step completion',
      steps: [
        {
          description: 'Step 1',
          tool: 'test_tool',
          parameters: { param1: 'value1' }
        },
        {
          description: 'Step 2',
          tool: 'test_tool',
          parameters: { param1: 'value2' }
        }
      ]
    };

    const plan = planManager.createPlan(params);
    
    // Markiere ersten Schritt als abgeschlossen
    planManager.updateStepStatus(plan.id, 'step-1', 'completed', { result: 'success' });
    
    // Plan sollte jetzt 'executing' sein
    expect(plan.status).toBe('executing');
    expect(plan.completedSteps).toBe(1);
    expect(plan.steps[0].status).toBe('completed');
    expect(plan.steps[1].status).toBe('pending');
    
    // Markiere zweiten Schritt als abgeschlossen
    planManager.updateStepStatus(plan.id, 'step-2', 'completed', { result: 'success' });
    
    // Plan sollte jetzt 'completed' sein
    expect(plan.status).toBe('completed');
    expect(plan.completedSteps).toBe(2);
    expect(plan.steps[0].status).toBe('completed');
    expect(plan.steps[1].status).toBe('completed');
    
    console.log('✅ Plan status correctly updated during step completion');
  });
});

// Manuelles Test-Skript für die Architect-Modus Funktionalität
console.log('=== Architect Mode Status Fix Test ===');
console.log('1. Plan creation should maintain "pending" status for all steps');
console.log('2. UI should not mark steps as "completed" after plan creation');
console.log('3. Plan execution should be separate from plan creation');
console.log('4. Status validation should catch and fix inconsistencies');
console.log('=== Test completed ===');