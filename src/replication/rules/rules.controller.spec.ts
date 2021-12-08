import { Test, TestingModule } from '@nestjs/testing';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

describe('RulesController', () => {
  let controller: RulesController;
  let mockRulesService: RulesService;

  beforeEach(async () => {
    mockRulesService = { loadRules: () => undefined } as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RulesController],
      providers: [{ provide: RulesService, useValue: mockRulesService }],
    }).compile();

    controller = module.get<RulesController>(RulesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should trigger a reload of the rules', () => {
    jest.spyOn(mockRulesService, 'loadRules');

    controller.reloadRules();

    expect(mockRulesService.loadRules).toHaveBeenCalled();
  });
});
