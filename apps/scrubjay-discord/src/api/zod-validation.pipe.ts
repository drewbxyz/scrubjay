import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from "@nestjs/common";
import { type ZodType, z } from "zod";

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: "VALIDATION",
        details: z.treeifyError(result.error),
        message: "Invalid request",
      });
    }
    return result.data;
  }
}
