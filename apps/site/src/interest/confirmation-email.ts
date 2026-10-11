import { interestConfirmationEmail } from "../bundled-content.generated.js";

export interface ConfirmationTemplate {
  readonly body: string;
  readonly from: string;
  readonly subject: string;
}

export const parseConfirmationTemplate = (
  raw: string
): ConfirmationTemplate => {
  const [head = "", ...bodyParts] = raw.split(/\r?\n\r?\n/u);

  const header = (name: string) =>
    head
      .split(/\r?\n/u)
      .find((line) => line.startsWith(`${name}: `))
      ?.slice(name.length + 2)
      .trim() ?? "";

  return {
    body: bodyParts.join("\n\n").trimEnd(),
    from: header("From"),
    subject: header("Subject"),
  };
};

export const confirmationTemplate = parseConfirmationTemplate(
  interestConfirmationEmail
);

export const confirmationText = (
  template: ConfirmationTemplate,
  confirmLink: string
) => template.body.replaceAll("{confirm_link}", confirmLink);
