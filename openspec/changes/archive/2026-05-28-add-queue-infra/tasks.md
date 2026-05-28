## 1. 依赖与连接

- [x] 1.1 引入 `bullmq` 依赖
- [x] 1.2 实现 BullMQ 专用 Redis 连接工厂（`maxRetriesPerRequest: null`），与 #1 幂等/限流的普通 `ioredis` 客户端分开（design D1）
- [x] 1.3 从配置读取 Redis 连接串（复用 #1 的 `.env`/配置加载），worker 与 server 共用同一份配置

## 2. 队列与 worker 封装

- [x] 2.1 实现 `Queue` 注册封装：校验队列名符合 `<capability>:<job-kind>`，集中维护已注册队列清单
- [x] 2.2 实现 `Worker` 封装：单进程可监听多队列，按 capability 分组配置 concurrency
- [x] 2.3 实现 `JobContext`（`log` 绑定 `queue`/`job_id`/`attempt`、注入 `now`、注入 `db`），在 job 处理起点构造（design D2）

## 3. 调度 API

- [x] 3.1 实现 `enqueue(queue, payload, opts)`（立即入队）
- [x] 3.2 实现 `schedule(queue, payload, delayMs, opts)`（延迟入队）
- [x] 3.3 实现 `repeatable(queue, payload, cron, opts)`（定时重复）
- [x] 3.4 调度 API 统一：入队前用 Zod 校验 payload、用业务 key 设 `jobId`、按 job 类型套重试档位

## 4. Payload schema 约定

- [x] 4.1 在 `packages/shared/src/jobs` 建立 Job payload schema 约定与目录结构（每队列一份 schema）
- [x] 4.2 worker 消费起点先 `parse` payload，不合法直接判失败（最终进死信，design D4）

## 5. 重试与幂等

- [x] 5.1 实现重试档位枚举：默认（attempts 3 / 退避 2s·8s·32s）、外部 API 类（5 次）、DB 写入类（不重试）（design D5）
- [x] 5.2 实现 jobId 幂等约定（业务 key 作 jobId，重复入队去重）

## 6. 死信扫描与告警

- [x] 6.1 实现每日 repeatable 死信扫描 job：遍历各队列 `getFailed()`，逐条打 `error` 级日志
- [x] 6.2 暴露可插拔 `alert(failedJobs)` hook（MVP 默认仅日志/空实现，预留真实渠道接入点，design D6）

## 7. 优雅退出

- [x] 7.1 worker 进程注册 SIGTERM/SIGINT handler：`worker.close()` 停接新 job、等在途 job、30s 超时强退（design D7）

## 8. Demo 队列

- [x] 8.1 实现 `infra:ping` demo 队列 + 处理器（仅供闭环验证，注释标注勿挂业务），证明「调度 → worker 处理」

## 9. Worker 进程入口

- [x] 9.1 实现 worker entry（`apps/server/src/worker.ts`）：只起 workers、不监听端口
- [x] 9.2 新增 `pnpm dev:worker` 脚本；补充 worker container 的部署/compose entry 说明

## 10. 测试基础设施

- [x] 10.1 实现队列测试 harness：真 Redis（复用 #1 globalSetup 容器）+ 真 worker，支持 Worker 事件驱动订阅以等待任务执行
- [x] 10.2 harness 支持延迟 job 的短真实延迟验证与死信构造（必失败 job 跑完 attempts）（design D8）

## 11. 测试用例

- [x] 11.1 调度/消费集成测试：enqueue 后 `getWaiting()` 断言入队 + payload 正确、worker 处理后副作用正确
- [x] 11.2 延迟 job 测试：短时间延迟到期前不执行、到期后被处理
- [x] 11.3 幂等测试：同 jobId 重复入队只存在一个 job、只处理一次
- [x] 11.4 payload 校验测试：非法 payload 不进业务、判失败
- [x] 11.5 重试/死信测试：必失败 job 跑完 attempts → 进 `failed` 集合；死信扫描打 error 日志 + 调用 alert hook
- [x] 11.6 graceful shutdown 测试：SIGTERM 后不再领新 job、在途 job 完成后退出
- [x] 11.7 队列命名校验测试：非法队列名注册报错
- [x] 11.8 demo `infra:ping` 闭环测试：调度 ping job → worker 处理成功
