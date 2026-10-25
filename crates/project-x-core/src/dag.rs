use crate::types::ExecutionPlan;
use std::collections::{HashMap, HashSet, VecDeque};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DagError {
    #[error("Step '{0}' declares dependency on unknown step '{1}'")]
    UnknownDependency(String, String),
    #[error("Cyclic dependency detected: {0}")]
    CycleDetected(String),
    #[error("Duplicate step id '{0}'")]
    DuplicateStepId(String),
}

#[derive(Debug, Clone)]
pub struct DagStructure {
    pub topological_order: Vec<String>,
    pub execution_waves: Vec<Vec<String>>,
    pub transitive_downstream: HashMap<String, HashSet<String>>,
}

pub fn build_dag(plan: &ExecutionPlan) -> Result<DagStructure, DagError> {
    let mut step_ids = HashSet::new();
    for step in &plan.spec.steps {
        if !step_ids.insert(&step.id) {
            return Err(DagError::DuplicateStepId(step.id.clone()));
        }
    }

    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut outgoing: HashMap<String, Vec<String>> = HashMap::new();

    for step in &plan.spec.steps {
        in_degree.insert(step.id.clone(), 0);
        outgoing.insert(step.id.clone(), Vec::new());
    }

    for step in &plan.spec.steps {
        for dep in &step.depends_on {
            if !step_ids.contains(dep) {
                return Err(DagError::UnknownDependency(step.id.clone(), dep.clone()));
            }
            outgoing.get_mut(dep).unwrap().push(step.id.clone());
            *in_degree.get_mut(&step.id).unwrap() += 1;
        }
    }

    let mut queue = VecDeque::new();
    let mut step_levels: HashMap<String, usize> = HashMap::new();

    for (id, &deg) in &in_degree {
        if deg == 0 {
            queue.push_back(id.clone());
            step_levels.insert(id.clone(), 0);
        }
    }

    let mut topological_order = Vec::new();

    while let Some(current) = queue.pop_front() {
        topological_order.push(current.clone());
        let current_level = step_levels[&current];

        if let Some(children) = outgoing.get(&current) {
            for child in children {
                let deg = in_degree.get_mut(child).unwrap();
                *deg -= 1;
                let next_level = current_level + 1;
                let existing_level = step_levels.entry(child.clone()).or_insert(0);
                if next_level > *existing_level {
                    *existing_level = next_level;
                }
                if *deg == 0 {
                    queue.push_back(child.clone());
                }
            }
        }
    }

    if topological_order.len() != plan.spec.steps.len() {
        return Err(DagError::CycleDetected(
            "Cycle detected among steps in execution plan".to_string(),
        ));
    }

    let max_level = step_levels.values().copied().max().unwrap_or(0);
    let mut execution_waves = vec![Vec::new(); max_level + 1];

    for step_id in &topological_order {
        let level = step_levels[step_id];
        execution_waves[level].push(step_id.clone());
    }

    let mut transitive_downstream: HashMap<String, HashSet<String>> = HashMap::new();
    for step in &plan.spec.steps {
        transitive_downstream.insert(step.id.clone(), HashSet::new());
    }

    for step_id in topological_order.iter().rev() {
        let mut all_downstream = HashSet::new();
        if let Some(direct_children) = outgoing.get(step_id) {
            for child in direct_children {
                all_downstream.insert(child.clone());
                if let Some(indirect) = transitive_downstream.get(child) {
                    all_downstream.extend(indirect.iter().cloned());
                }
            }
        }
        transitive_downstream.insert(step_id.clone(), all_downstream);
    }

    Ok(DagStructure {
        topological_order,
        execution_waves,
        transitive_downstream,
    })
}
