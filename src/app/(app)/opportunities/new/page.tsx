import { PageHeader } from "@/components/ui";
import { providerStatus } from "@/lib/ai/providers";
import { IdeaForm } from "./IdeaForm";

export const metadata = { title: "Submit idea" };

export default function NewIdea() {
  return (
    <>
      <PageHeader title="Submit an idea" subtitle="A few words is enough. It is saved first; interpretation runs after." />
      <IdeaForm aiConfigured={providerStatus().configured} />
    </>
  );
}
