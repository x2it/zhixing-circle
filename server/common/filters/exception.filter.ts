import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { BusinessException } from '../interfaces/exception.interface';
import { HTTP_STATUS_TO_RESPONSE_CODE_MAP, ResponseCode } from '../constants/api_response_code';
import { ApiErrorResponse } from '../interfaces/api_response.interface';

/** 从异常对象（含嵌套 cause）中提取 Postgres 错误码（形如 22P02 / 23505，字母数字混合） */
function extractPgCode(exception: unknown, depth = 0): string | undefined {
  if (typeof exception !== 'object' || exception === null || depth > 4) return undefined;
  const code = (exception as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Z0-9]{5}$/i.test(code.trim())) return code.trim().toUpperCase();
  return extractPgCode((exception as { cause?: unknown }).cause, depth + 1);
}

// 全局异常过滤器，用于捕获所有未处理的异常
// 安全约定：stack/cause 只写服务端日志，响应体仅保留 code/message/timestamp
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // 如果响应头已发送，则不处理
    if (response.headersSent) {
      return;
    }

    let errorResponse: Omit<ApiErrorResponse, 'httpStatus'>;
    let httpStatus: HttpStatus;
    /** 顶层 message: 所有错误响应统一携带 { message } 字段, 便于客户端统一读取 */
    let topMessage = '服务器内部错误';

    if (exception instanceof BusinessException) {
      // 业务异常
      httpStatus = exception.httpStatus;
      topMessage = exception.message;
      errorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          fieldErrors: exception.fieldErrors,
          timestamp: Date.now(),
        },
      };
    } else if (exception instanceof HttpException) {
      // HTTP异常
      httpStatus = exception.getStatus() as HttpStatus;
      const exceptionResponse = exception.getResponse();

      // 取业务语义的 message（优先对象中的 message 字段）
      topMessage = typeof exceptionResponse === 'object' && exceptionResponse !== null && (exceptionResponse as { message?: unknown }).message
        ? String((exceptionResponse as { message: unknown }).message)
        : exception.message;

      errorResponse = {
        error: {
          code: HTTP_STATUS_TO_RESPONSE_CODE_MAP[httpStatus],
          message: typeof exceptionResponse === 'string' ? exceptionResponse : exception.message,
          details: typeof exceptionResponse === 'object' ? JSON.stringify(exceptionResponse) : undefined,
          timestamp: Date.now(),
        },
      };
    } else if (extractPgCode(exception) === '22P02') {
      // Postgres invalid_text_representation：路径/查询参数与列类型不匹配（最常见是非法 UUID）
      // 与「合法 UUID 但记录不存在」走同一条 not-found 语义，避免 500 噪声
      // （drizzle 会把原始 pg error 包进 cause 链，这里递归提取错误码）
      httpStatus = HttpStatus.NOT_FOUND;
      topMessage = '资源不存在';
      errorResponse = {
        error: {
          code: ResponseCode.NOT_FOUND,
          message: '资源不存在',
          timestamp: Date.now(),
        },
      };
    } else if (extractPgCode(exception) === '23505') {
      // 唯一约束冲突
      httpStatus = HttpStatus.CONFLICT;
      topMessage = '数据冲突（唯一性约束）';
      errorResponse = {
        error: {
          code: ResponseCode.CONFLICT,
          message: '数据冲突（唯一性约束）',
          timestamp: Date.now(),
        },
      };
    } else {
      // 未知异常：stack/cause 仅写服务端日志，绝不返回给客户端
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      errorResponse = {
        error: {
          code: ResponseCode.INTERNAL_ERROR,
          message: '服务器内部错误',
          timestamp: Date.now(),
        },
      };
    }

    // 统一输出: { message, error: {...} } —— message 为顶层便捷字段
    response.status(httpStatus).json({ message: topMessage, ...errorResponse });
  }
}
