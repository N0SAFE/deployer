// packages/nest/schema/src/global/utils/zod-enum.ts
import { AppError } from "@deployer/errors";
function zodEnumToPgEnumValues(schema) {
  const values = [...schema.options];
  if (values.length === 0) {
    throw new AppError("zodEnumToPgEnumValues requires at least one enum value", "INTERNAL_ERROR");
  }
  return values;
}
export {
  zodEnumToPgEnumValues
};
