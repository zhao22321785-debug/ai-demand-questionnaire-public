export const employeeDimensionDefinitions = [
  {
    key: 'ai_suitability',
    name: 'AI 适用场景判断',
    shortName: '场景判断',
    description: '是否会结合任务价值、信息敏感性和出错影响判断 AI 的适用环节。',
    question: '面对一项工作时，您通常如何判断是否使用 AI？',
  },
  {
    key: 'task_preparation',
    name: '任务目标与信息准备',
    shortName: '信息准备',
    description: '开始前是否说明目标、材料、输出要求和不能改变的限制。',
    question: '回想最近一次请 AI 帮助处理一项具体工作，下面哪种情况最接近您开始时的做法？',
  },
  {
    key: 'iteration_adjustment',
    name: '结果偏差识别与过程调整',
    shortName: '过程调整',
    description: '面对结果偏差时，是否会补充背景、分步确认并在必要时停止。',
    question: '当 AI 第一次给出的结果与您的需要有差距时，下面哪种情况最接近您通常的处理方式？',
  },
  {
    key: 'result_verification',
    name: 'AI 结果核验与人工确认',
    shortName: '结果核验',
    description: '是否核验关键事实、数据和来源，并按影响程度设置人工确认。',
    question: '回想最近一次将 AI 生成的内容用于工作，下面哪种情况最接近您当时的处理方式？',
  },
  {
    key: 'workflow_integration',
    name: 'AI 融入工作流程',
    shortName: '流程使用',
    description: '是否把 AI 放入稳定的连续步骤，并明确人工接手和异常处理。',
    question: '回想一项您曾经借助 AI 处理的工作，下面哪种情况最接近 AI 在其中的使用方式？',
  },
  {
    key: 'method_reuse',
    name: '方法沉淀与协作复用',
    shortName: '方法复用',
    description: '是否沉淀适用条件、模板和检查点，供自己或同事复用。',
    question: '当您再次使用 AI 处理一项与之前相似的工作时，下面哪种情况最接近您的做法？',
  },
] as const;
