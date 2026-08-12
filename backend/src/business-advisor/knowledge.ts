export interface KnowledgeEntry {
  readonly category: string;
  readonly title: string;
  readonly content: string;
}

export interface AgentKnowledgeBase {
  readonly agentId: string;
  readonly entries: readonly KnowledgeEntry[];
}

const STANDARD_ENTRIES: Record<string, readonly KnowledgeEntry[]> = {
  finance: Object.freeze([
    Object.freeze({
      category: "指标体系",
      title: "核心财务指标口径",
      content:
        "毛利率=毛利/收入；净利率=净利润/收入；ROE=净利润/净资产；ROA=净利润/总资产；资产负债率=总负债/总资产；应收周转天数=应收账款/收入×365；现金保障月数=期末现金/月均毛利。"
    }),
    Object.freeze({
      category: "解读原则",
      title: "三张报表联动看问题",
      content:
        "收入增长但经营现金下降，优先核查应收账款与存货占用；利润改善但现金恶化，警惕赊销扩张；负债上升要看是否投向经营性资产。"
    })
  ]),
  profit: Object.freeze([
    Object.freeze({
      category: "管理会计",
      title: "真实利润口径",
      content:
        "真实利润=收入-直接成本-售后成本-运输成本-销售费用-分摊管理成本。毛利好看不等于真赚钱；扣除后仍低于警戒线的产品称为假利润。"
    }),
    Object.freeze({
      category: "客户分析",
      title: "客户 ABC 分类",
      content:
        "A 类：真实利润率≥20%且回款≤60天；B 类：真实利润率≥0且回款≤90天；C 类：负利润或拖款超90天。大客户不等于好客户，要按真实贡献排序。"
    })
  ]),
  cost: Object.freeze([
    Object.freeze({
      category: "成本结构",
      title: "固定/变动/半变动成本",
      content:
        "固定成本：人工、租金、折旧；变动成本：原材料、直接计件；半变动成本：销售提成。材料成本率异常波动需核查涨价、采购异常与产品结构变化。"
    })
  ]),
  cashflow: Object.freeze([
    Object.freeze({
      category: "资金管理",
      title: "利润增长现金断裂风险",
      content:
        "当收入增长但应收账款增速明显更快时，利润表好看但现金会被占用。未来30/90天现金预测为负即触发资金断裂预警，需优先压缩应收与库存。"
    })
  ]),
  tax: Object.freeze([
    Object.freeze({
      category: "合规边界",
      title: "税务健康检查边界",
      content:
        "本智能体只做风险体检（发票、收入确认、成本真实性、个税、股权），输出红黄绿分级；不做避税方案，所有结论需由执业税务师复核。"
    })
  ]),
  cfo: Object.freeze([
    Object.freeze({
      category: "咨询框架",
      title: "经营诊断报告结构",
      content:
        "报告=企业健康评分+三大问题(问题→原因→建议)+未来90天行动计划。行动按月度展开：先清理低利润客户/产品，再调报价与成本，最后做资金与预算安排。"
    })
  ])
};

export function standardAgentKnowledgeBase(
  agentId: string
): AgentKnowledgeBase {
  return Object.freeze({
    agentId,
    entries: Object.freeze([
      ...(STANDARD_ENTRIES[agentId] ?? [])
    ])
  });
}

export function allStandardAgentKnowledgeBases(): readonly AgentKnowledgeBase[] {
  return Object.freeze(
    Object.keys(STANDARD_ENTRIES).map((agentId) =>
      standardAgentKnowledgeBase(agentId))
  );
}

/** 外部资料注入点：把课程方法论、行业基准、脱敏报表样本等按 agentId 追加。 */
export function extendAgentKnowledgeBase(
  base: AgentKnowledgeBase,
  extra: readonly KnowledgeEntry[]
): AgentKnowledgeBase {
  return Object.freeze({
    agentId: base.agentId,
    entries: Object.freeze([
      ...base.entries,
      ...extra.map((entry) => Object.freeze({ ...entry }))
    ])
  });
}
