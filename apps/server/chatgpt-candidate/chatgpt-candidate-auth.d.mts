import type { FastifyInstance } from 'fastify';
export const CANDIDATE_LOGIN_PATH: '/__chatgpt-candidate-login';
export function installChatGptCandidateAuth(app: FastifyInstance, options: {tokenFile:string}): Promise<void>;
export function installChatGptWorkbenchAccess(app: FastifyInstance, options: {origin:string}): Promise<void>;
