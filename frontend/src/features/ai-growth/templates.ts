import type { IndustryTemplateId } from "./types.js";

export interface IndustryTemplateDraft {
  targetProfile: string;
  targetRegions: string[];
  companySize: string;
  demandSignals: string[];
  exclusionConditions: string[];
}

export interface IndustryTemplate {
  id: IndustryTemplateId;
  label: string;
  taskText: string;
  draft: IndustryTemplateDraft;
}

function template(
  id: IndustryTemplateId,
  label: string,
  taskText: string,
  draft: IndustryTemplateDraft
): IndustryTemplate {
  return { id, label, taskText, draft };
}

export const industryTemplates: readonly IndustryTemplate[] = [
  template(
    "enterprise-services",
    "企业服务",
    "帮我寻找上海近期可能有数字化采购需求、员工规模 50 人以上的制造企业。",
    {
      targetProfile: "有数字化采购需求的制造企业",
      targetRegions: ["上海"],
      companySize: "50 人以上",
      demandSignals: ["数字化采购", "系统升级", "效率改善"],
      exclusionConditions: ["勿扰名单", "非企业主体"]
    }
  ),
  template(
    "export-manufacturing",
    "外贸制造",
    "寻找有出口增长、供应链协同或海外获客需求的制造企业。",
    {
      targetProfile: "有出口业务的制造企业",
      targetRegions: ["长三角", "珠三角"],
      companySize: "50 人以上",
      demandSignals: ["出口增长", "海外展会", "供应链协同"],
      exclusionConditions: ["勿扰名单", "无出口业务"]
    }
  ),
  template(
    "renovation",
    "装修",
    "寻找近期有装修、工装或空间改造需求的企业和项目。",
    {
      targetProfile: "有办公或商业空间改造需求的企业",
      targetRegions: ["上海"],
      companySize: "20 人以上",
      demandSignals: ["新址启用", "门店扩张", "空间改造"],
      exclusionConditions: ["勿扰名单", "个人住宅"]
    }
  ),
  template(
    "beauty",
    "美业",
    "寻找有门店增长、数字化运营或供应链升级需求的美业品牌。",
    {
      targetProfile: "有连锁或增长需求的美业品牌",
      targetRegions: ["上海"],
      companySize: "10 人以上",
      demandSignals: ["开店扩张", "会员运营", "品牌升级"],
      exclusionConditions: ["勿扰名单", "个人从业者"]
    }
  ),
  template(
    "education",
    "教培",
    "寻找有招生增长、课程数字化或校区扩张需求的教育机构。",
    {
      targetProfile: "有增长和数字化需求的教育机构",
      targetRegions: ["上海"],
      companySize: "20 人以上",
      demandSignals: ["校区扩张", "课程升级", "招生增长"],
      exclusionConditions: ["勿扰名单", "个人家教"]
    }
  ),
  template(
    "custom",
    "自定义行业",
    "描述你希望寻找的目标客户。",
    {
      targetProfile: "",
      targetRegions: [],
      companySize: "",
      demandSignals: [],
      exclusionConditions: []
    }
  )
];

export const defaultIndustryTemplateId: IndustryTemplateId =
  "enterprise-services";
