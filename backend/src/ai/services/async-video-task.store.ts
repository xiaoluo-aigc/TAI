/**
 * 异步视频生成任务状态存储
 * 用于存储异步任务的结果，供前端轮询查询
 */
export interface AsyncTaskResult {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: {
    videoUrl?: string;
    thumbnailUrl?: string;
    modelUrl?: string;
    modelKey?: string;
    promptId?: string;
    content?: string;
    referencedUrls?: string[];
    status?: string;
    taskId?: string;
    taskInfo?: Record<string, any>;
    videoUrlRaw?: string;
    videoUrlWatermarked?: string;
    watermarkSkipped?: boolean;
    watermarkFailed?: boolean;
    fallbackMessage?: string;
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// 内存存储（生产环境建议使用 Redis）
const taskResults = new Map<string, AsyncTaskResult>();

const TASK_RESULT_TTL_MS = 30 * 60 * 1000; // 30分钟后过期

/**
 * 创建异步任务
 */
export function createAsyncTask(taskId: string): AsyncTaskResult {
  const now = Date.now();
  const task: AsyncTaskResult = {
    taskId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  taskResults.set(taskId, task);

  // 定时清理过期任务
  setTimeout(() => {
    taskResults.delete(taskId);
  }, TASK_RESULT_TTL_MS);

  return task;
}

/**
 * 更新任务状态
 */
export function updateAsyncTask(
  taskId: string,
  update: Partial<Pick<AsyncTaskResult, 'status' | 'result' | 'error'>>
): void {
  const task = taskResults.get(taskId);
  if (task) {
    Object.assign(task, update, { updatedAt: Date.now() });
  }
}

/**
 * 获取任务结果
 */
export function getAsyncTaskResult(taskId: string): AsyncTaskResult | undefined {
  return taskResults.get(taskId);
}
