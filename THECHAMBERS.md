# TheChambers Workrooms

Workrooms let an owner coordinate a software task on the same TheChambers server. Each worker has a separate login and sees their assigned task rooms. ID 1 Admin uses the regular TheChambers login and can view every room, including its private messages.

## Set up worker access

1. As ID 1 Admin, sign in and open **Settings → Workrooms**.
2. In **Workers**, enter a name, email address, and role. Select **Add worker and generate password**.
3. Copy the generated password and give it to the worker privately. The password is shown once, and the email address is used for sign-in. TheChambers stores a hash of the password.
4. Each worker opens `/workrooms` in a separate browser profile or private window and signs in with the email and password. Use your TheChambers HTTPS address, including when connecting over Tailscale.

Admin can view workers, edit their name, email, or role, reset their password, and remove their access. Password reset and removal revoke the worker’s current login. Workers can sign in and out, post room messages, and take actions allowed by their assignment. Admin can reassign an open task after removing a worker. Private messages from a former assignee remain visible to Admin.

## Move a task from brief to GitHub

Create a task with a shared brief, a local Git checkout on the server, a GitHub destination branch, and a worker for each role. Use a checkout you trust, with a GitHub `origin` and Git credentials already configured for the server account.

| Step | Owner | Action |
| --- | --- | --- |
| 1 | Planner and Designer | Submit the plan and design from their rooms. |
| 2 | Debugger | Review both handoffs and record evidence or request changes. |
| 3 | ID 1 Admin | Approve the brief after the Debugger passes it. |
| 4 | Programmer | Implement in the approved checkout, commit the work, and submit the full hash and implementation notes. |
| 5 | Debugger | Test the submitted commit and record results, or request a fix. |
| 6 | ID 1 Admin | Approve the exact verified commit for release. |
| 7 | Programmer | Push that commit to the configured destination branch through Workrooms. |

Use **Refresh rooms** to see newly submitted handoffs. Submitting a replacement commit clears previous verification and release approval. Commit submission, verification, approval, and push require a clean checkout at the reviewed commit. The application uses a regular Git push and follows GitHub’s permissions and branch rules.

## Usage allowances and execution

Set a total allowance as Admin. Workrooms assigns 45% to Programmer, 25% to Designer, 20% to Planner, and reserves 10% for Debugger, rounded up for a budget entered in whole units. Each role can report units up to its allowance. Agree on the unit to track before starting.

Workrooms coordinates human handoffs and manually reported usage. The board does not launch agents, enforce a provider’s token or billing limit, or grant workers access to the browser terminal. Git operations outside Workrooms remain governed by the host’s permissions and GitHub’s own access controls. Worker accounts and the board are stored in the host’s local TheChambers configuration directory.
