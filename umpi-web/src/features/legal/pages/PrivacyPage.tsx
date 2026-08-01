/**
 * PrivacyPage — Política de Privacidad de UMPI.
 * Copy is the client's literal legal text — do NOT translate or edit.
 */
import LegalPageLayout from '../components/LegalPageLayout'
import { LEGAL_VERSION_LABEL } from '../legalContent'

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Política de Privacidad de UMPI."
      updatedAt={`Última actualización: ${LEGAL_VERSION_LABEL}`}
    >
      <section>
        <p className="text-text-secondary leading-relaxed">
          En UMPI, nos comprometemos a proteger la privacidad de los usuarios.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Información que recolectamos
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Recopilamos datos personales como tu nombre, correo electrónico y teléfono, únicamente necesarios para gestionar tus publicaciones y facilitar el contacto entre usuarios.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Uso de la información
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Tus datos se utilizan exclusivamente para que el marketplace funcione correctamente, permitiendo mostrar tus anuncios y conectar buyers y sellers.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Protección de datos
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Implementamos medidas de seguridad para resguardar tu información personal y evitar accesos no autorizados.
        </p>
      </section>

      <section>
        <p className="text-text-secondary leading-relaxed">
          Si tenés alguna duda sobre cómo manejamos tus datos, no dudes en preguntar.
        </p>
      </section>
    </LegalPageLayout>
  )
}
