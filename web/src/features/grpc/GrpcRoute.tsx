import { GrpcWorkbenchView } from './GrpcWorkbenchView';
import { useGrpcWorkbench } from './workspace/useGrpcWorkbench';

export function GrpcRoute() {
  return <GrpcWorkbenchView model={useGrpcWorkbench()} />;
}
