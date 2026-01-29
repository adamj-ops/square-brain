# Brain Item Types

The Brain supports four core item types, each serving a distinct purpose in organizational knowledge management.

## Item Types

### Decision

**Purpose**: Record key choices and their rationale.

Decisions capture the "why" behind important choices. They should include:
- The decision made
- Context and constraints
- Alternatives considered
- Rationale for the choice
- Expected outcomes

**Example**: "We decided to use PostgreSQL over MongoDB because our data is highly relational and we need strong consistency guarantees."

### SOP (Standard Operating Procedure)

**Purpose**: Document repeatable processes and procedures.

SOPs provide step-by-step instructions for common tasks. They should include:
- Prerequisites
- Step-by-step instructions
- Expected outcomes
- Troubleshooting tips
- Who is responsible

**Example**: "Customer Onboarding SOP: Step 1: Send welcome email. Step 2: Schedule kickoff call..."

### Principle

**Purpose**: Capture guiding beliefs and rules.

Principles are high-level guidelines that inform decision-making. They should be:
- Concise and memorable
- Broadly applicable
- Reflect organizational values
- Help resolve ambiguous situations

**Example**: "Always choose reversible decisions when possible - optimize for learning over perfection."

### Playbook

**Purpose**: Provide comprehensive guides for complex scenarios.

Playbooks are detailed guides for handling specific situations. They combine:
- Context and background
- Decision trees
- Action steps
- Communication templates
- Escalation paths

**Example**: "Incident Response Playbook: How to handle production outages from detection to post-mortem."

## Choosing the Right Type

| Scenario | Type |
|----------|------|
| Recording a choice you made | Decision |
| Documenting a repeatable process | SOP |
| Establishing a guiding rule | Principle |
| Creating a comprehensive guide | Playbook |

## Common Tags

Items can be tagged for better organization:
- `engineering`, `product`, `marketing`, `sales`
- `urgent`, `archived`, `draft`
- `team-<name>`, `project-<name>`
