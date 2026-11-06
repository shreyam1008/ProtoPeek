import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'kubectl',
  download: 'https://kubernetes.io/docs/tasks/tools/',
  guide: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_port-forward/',
  setup: 'Install kubectl and select an authorized cluster context.',
  afterSetup:
    'Choose the cluster, namespace and service. Forward its port locally, then inspect that port.',
  notes: [
    'Use kubectl to choose your cluster context and authorize access.',
    'The example binds 127.0.0.1 in the current namespace. Replace service/example deliberately; stop the native forward when finished.',
  ],
  commands: [
    {
      label: 'Example: loopback-only service forward',
      text: 'kubectl port-forward --address 127.0.0.1 service/example 8080:80',
    },
  ],
  endpoint: {
    url: 'http://127.0.0.1:8080/',
    notice:
      'Example forwarded HTTP port. Verify context, service and the listening local port before Send.',
  },
} satisfies ExtensionPack;

export default extension;
