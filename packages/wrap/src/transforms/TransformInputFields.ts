import {
  GraphQLSchema,
  GraphQLType,
  DocumentNode,
  TypeInfo,
  visit,
  visitWithTypeInfo,
  Kind,
  FragmentDefinitionNode,
  GraphQLInputObjectType,
  ObjectValueNode,
  ObjectFieldNode,
} from 'graphql';

import { Transform, Request, MapperKind, mapSchema } from '@graphql-tools/utils';
import { InputFieldTransformer, InputFieldNodeTransformer } from '../types';

export default class TransformInputFields implements Transform {
  private readonly inputFieldTransformer: InputFieldTransformer;
  private readonly inputFieldNodeTransformer: InputFieldNodeTransformer;
  private transformedSchema: GraphQLSchema;
  private mapping: Record<string, Record<string, string>>;

  constructor(inputFieldTransformer: InputFieldTransformer, inputFieldNodeTransformer?: InputFieldNodeTransformer) {
    this.inputFieldTransformer = inputFieldTransformer;
    this.inputFieldNodeTransformer = inputFieldNodeTransformer;
    this.mapping = {};
  }

  public transformSchema(originalSchema: GraphQLSchema): GraphQLSchema {
    this.transformedSchema = mapSchema(originalSchema, {
      [MapperKind.INPUT_OBJECT_TYPE]: (type: GraphQLInputObjectType) =>
        this.transformFields(type, this.inputFieldTransformer),
    });

    return this.transformedSchema;
  }

  public transformRequest(originalRequest: Request): Request {
    const fragments = Object.create(null);
    originalRequest.document.definitions
      .filter(def => def.kind === Kind.FRAGMENT_DEFINITION)
      .forEach(def => {
        fragments[(def as FragmentDefinitionNode).name.value] = def;
      });
    const document = this.transformDocument(
      originalRequest.document,
      this.mapping,
      this.inputFieldNodeTransformer,
      originalRequest.variables
    );
    return {
      ...originalRequest,
      document,
    };
  }

  private transformFields(type: GraphQLInputObjectType, inputFieldTransformer: InputFieldTransformer): any {
    const config = type.toConfig();

    const originalInputFieldConfigMap = config.fields;
    const newInputFieldConfigMap = {};

    Object.keys(originalInputFieldConfigMap).forEach(fieldName => {
      const originalInputFieldConfig = originalInputFieldConfigMap[fieldName];
      const transformedField = inputFieldTransformer(type.name, fieldName, originalInputFieldConfig);

      if (transformedField === undefined) {
        newInputFieldConfigMap[fieldName] = originalInputFieldConfig;
      } else if (Array.isArray(transformedField)) {
        const newFieldName = transformedField[0];
        const newFieldConfig = transformedField[1];
        newInputFieldConfigMap[newFieldName] = newFieldConfig;

        if (newFieldName !== fieldName) {
          const typeName = type.name;
          if (!(typeName in this.mapping)) {
            this.mapping[typeName] = {};
          }
          this.mapping[typeName][newFieldName] = fieldName;
        }
      } else if (transformedField != null) {
        newInputFieldConfigMap[fieldName] = transformedField;
      }
    });

    if (!Object.keys(newInputFieldConfigMap).length) {
      return null;
    }

    return new GraphQLInputObjectType({
      ...type.toConfig(),
      fields: newInputFieldConfigMap,
    });
  }

  private transformDocument(
    document: DocumentNode,
    mapping: Record<string, Record<string, string>>,
    inputFieldNodeTransformer: InputFieldNodeTransformer,
    variables: Record<string, any>
  ): DocumentNode {
    const typeInfo = new TypeInfo(this.transformedSchema);
    const newDocument: DocumentNode = visit(
      document,
      visitWithTypeInfo(typeInfo, {
        leave: {
          [Kind.OBJECT]: (node: ObjectValueNode): ObjectValueNode => {
            const parentType: GraphQLType = typeInfo.getInputType() as GraphQLInputObjectType;
            if (parentType != null) {
              const parentTypeName = parentType.name;
              const newInputFields: Array<ObjectFieldNode> = [];

              node.fields.forEach(inputField => {
                const newName = inputField.name.value;

                const transformedInputField =
                  inputFieldNodeTransformer != null
                    ? inputFieldNodeTransformer(parentTypeName, newName, inputField, variables)
                    : inputField;

                if (Array.isArray(transformedInputField)) {
                  transformedInputField.forEach(individualTransformedInputField => {
                    const typeMapping = mapping[parentTypeName];
                    if (typeMapping == null) {
                      newInputFields.push(individualTransformedInputField);
                      return;
                    }

                    const oldName = typeMapping[newName];
                    if (oldName == null) {
                      newInputFields.push(individualTransformedInputField);
                      return;
                    }

                    newInputFields.push({
                      ...individualTransformedInputField,
                      name: {
                        ...individualTransformedInputField.name,
                        value: oldName,
                      },
                    });
                  });
                  return;
                }

                const typeMapping = mapping[parentTypeName];
                if (typeMapping == null) {
                  newInputFields.push(transformedInputField);
                  return;
                }

                const oldName = typeMapping[newName];
                if (oldName == null) {
                  newInputFields.push(transformedInputField);
                  return;
                }

                newInputFields.push({
                  ...transformedInputField,
                  name: {
                    ...transformedInputField.name,
                    value: oldName,
                  },
                });
              });

              return {
                ...node,
                fields: newInputFields,
              };
            }
          },
        },
      })
    );
    return newDocument;
  }
}
