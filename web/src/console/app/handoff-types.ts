export const handoffKinds = ['grpc-target-draft', 'http-url-draft'] as const;

export type HandoffKind = (typeof handoffKinds)[number];
