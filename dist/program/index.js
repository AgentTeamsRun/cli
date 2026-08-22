import { Command } from 'commander';
import { registerAgentConfigCommand } from './agentConfig.js';
import { registerAttachmentCommand } from './attachment.js';
import { registerAuthCommand } from './auth.js';
import { registerChangeSetCommand } from './changeSet.js';
import { registerCoactionCommand } from './coaction.js';
import { registerCodeReviewCommand } from './codeReview.js';
import { registerCommentCommand } from './comment.js';
import { registerConfigCommand } from './config.js';
import { registerConventionCommand } from './convention.js';
import { registerDependencyCommand } from './dependency.js';
import { registerDoctorCommand } from './doctor.js';
import { registerDocumentCommand } from './document.js';
import { registerFeedbackCommand } from './feedback.js';
import { registerGuideCommand } from './guide.js';
import { registerInitCommand } from './init.js';
import { registerLinearCommand } from './linear.js';
import { registerMcpCommand } from './mcp.js';
import { registerPlanCommand } from './plan.js';
import { registerPostmortemCommand } from './postmortem.js';
import { registerReportCommand } from './report.js';
import { registerResolveCommand } from './resolve.js';
import { registerSearchCommand } from './search.js';
import { registerSentryCommand } from './sentry.js';
import { registerSessionCommand } from './session.js';
import { registerSkillCommand } from './skill.js';
import { registerSyncCommand } from './sync.js';
import { registerTaskCommand } from './task.js';
import { registerWorktreeCommand } from './worktree.js';
import { registerApiKeyHook, removedContractHint } from './shared.js';
export function createProgram(version) {
    const program = new Command();
    // 서브커맨드는 생성 시점에 outputConfiguration을 상속하므로 등록보다 먼저 설정합니다.
    program.configureOutput({
        writeErr: (text) => {
            process.stderr.write(text);
            const hint = removedContractHint(text);
            if (hint)
                process.stderr.write(`hint: ${hint}\n`);
        },
    });
    registerApiKeyHook(program);
    program.name('agentteams').description('CLI tool for AgentTeams API').version(version);
    registerInitCommand(program);
    registerAuthCommand(program);
    registerDoctorCommand(program);
    registerSyncCommand(program);
    registerSessionCommand(program);
    registerGuideCommand(program);
    registerWorktreeCommand(program);
    registerPlanCommand(program);
    registerResolveCommand(program);
    registerTaskCommand(program);
    registerCommentCommand(program);
    registerAttachmentCommand(program);
    registerReportCommand(program);
    registerCodeReviewCommand(program);
    registerChangeSetCommand(program);
    registerPostmortemCommand(program);
    registerCoactionCommand(program);
    registerFeedbackCommand(program);
    registerConventionCommand(program);
    registerDocumentCommand(program);
    registerDependencyCommand(program);
    registerAgentConfigCommand(program);
    registerConfigCommand(program);
    registerSearchCommand(program);
    registerMcpCommand(program);
    registerLinearCommand(program);
    registerSentryCommand(program);
    registerSkillCommand(program);
    return program;
}
//# sourceMappingURL=index.js.map