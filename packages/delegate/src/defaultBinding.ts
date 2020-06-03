import { GraphQLSchema, GraphQLOutputType, OperationTypeNode, GraphQLObjectType } from 'graphql';

import { Transform } from '@graphql-tools/utils';

import { StitchingInfo, isSubschemaConfig, DelegationContext } from './types';

import ExpandAbstractTypes from './transforms/ExpandAbstractTypes';
import WrapConcreteTypes from './transforms/WrapConcreteTypes';
import FilterToSchema from './transforms/FilterToSchema';
import AddFragmentsByField from './transforms/AddFragmentsByField';
import AddSelectionSetsByField from './transforms/AddSelectionSetsByField';
import AddSelectionSetsByType from './transforms/AddSelectionSetsByType';
import AddTypenameToAbstract from './transforms/AddTypenameToAbstract';
import CheckResultAndHandleErrors from './transforms/CheckResultAndHandleErrors';
import AddArgumentsAsVariables from './transforms/AddArgumentsAsVariables';

function getDelegationReturnType(
  targetSchema: GraphQLSchema,
  operation: OperationTypeNode,
  fieldName: string
): GraphQLOutputType {
  let rootType: GraphQLObjectType<any, any>;
  if (operation === 'query') {
    rootType = targetSchema.getQueryType();
  } else if (operation === 'mutation') {
    rootType = targetSchema.getMutationType();
  } else {
    rootType = targetSchema.getSubscriptionType();
  }

  return rootType.getFields()[fieldName].type;
}

export function defaultBinding(delegationContext: DelegationContext): Array<Transform> {
  const {
    subschema: schemaOrSubschemaConfig,
    targetSchema,
    operation,
    fieldName,
    args,
    context,
    info,
    returnType,
    transforms = [],
    transformedSchema,
    skipTypeMerging,
  } = delegationContext;
  const stitchingInfo: StitchingInfo = info?.schema.extensions?.stitchingInfo;

  const transformedTargetSchema =
    stitchingInfo == null
      ? transformedSchema ?? targetSchema
      : stitchingInfo.transformedSchemas.get(schemaOrSubschemaConfig) ?? transformedSchema ?? targetSchema;
  delegationContext.transformedSchema = transformedTargetSchema;

  const delegationReturnType =
    returnType ?? info?.returnType ?? getDelegationReturnType(targetSchema, operation, fieldName);
  delegationContext.returnType = delegationReturnType;

  const delegationTransforms: Array<Transform> = [];

  delegationTransforms.push(
    new CheckResultAndHandleErrors(
      info,
      fieldName,
      schemaOrSubschemaConfig,
      context,
      delegationReturnType,
      skipTypeMerging
    )
  );

  if (stitchingInfo != null) {
    delegationTransforms.push(new AddSelectionSetsByField(info.schema, stitchingInfo.selectionSetsByField));
    delegationTransforms.push(new AddSelectionSetsByType(info.schema, stitchingInfo.selectionSetsByType));
  }

  delegationTransforms.push(new WrapConcreteTypes(delegationReturnType, transformedTargetSchema));

  if (info != null) {
    delegationTransforms.push(new ExpandAbstractTypes(info.schema, transformedTargetSchema));
  }

  let finalSubschemaTransforms: Array<Transform>;
  if (isSubschemaConfig(schemaOrSubschemaConfig)) {
    finalSubschemaTransforms =
      schemaOrSubschemaConfig.transforms != null ? schemaOrSubschemaConfig.transforms.concat(transforms) : transforms;
  } else {
    finalSubschemaTransforms = transforms;
  }

  for (let i = finalSubschemaTransforms.length - 1; i > -1; i--) {
    delegationTransforms.push(finalSubschemaTransforms[i], {});
  }

  if (stitchingInfo != null) {
    delegationTransforms.push(new AddFragmentsByField(targetSchema, stitchingInfo.fragmentsByField));
  }

  if (args != null) {
    delegationTransforms.push(new AddArgumentsAsVariables(targetSchema, args));
  }

  delegationTransforms.push(new FilterToSchema(targetSchema));
  delegationTransforms.push(new AddTypenameToAbstract(targetSchema));

  return delegationTransforms;
}
